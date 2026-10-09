import { claudeCode } from "@mothership/providers";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { handleHookRequest, type CrewSignalEvent } from "../../src/features/crew/hooks.server.ts";
import { CrewRegistry } from "../../src/features/crew/registry.server.ts";

function setup() {
  const registry = new CrewRegistry();
  const { token } = registry.register("crew-1", { missionId: "m1", provider: "claude-code" });
  const published: CrewSignalEvent[] = [];
  const deps = {
    registry,
    providers: { "claude-code": claudeCode },
    publish: (e: CrewSignalEvent) => published.push(e),
  };
  return { registry, token, published, deps };
}

function post(body: unknown, headers: Record<string, string>) {
  return new Request("http://127.0.0.1:3000/api/hooks", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const preToolUse = {
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_input: { file_path: "/work/repo/src/a.ts" },
};

describe("CrewRegistry", () => {
  test("issues a distinct random token per crew", () => {
    const registry = new CrewRegistry();
    const a = registry.register("a", { missionId: "m1", provider: "claude-code" });
    const b = registry.register("b", { missionId: "m2", provider: "claude-code" });
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toBe(b.token);
  });

  test("verifies tokens per crew", () => {
    const registry = new CrewRegistry();
    const { token } = registry.register("a", { missionId: "m1", provider: "claude-code" });
    expect(registry.verify("a", token)?.missionId).toBe("m1");
    expect(registry.verify("a", "wrong")).toBeNull();
    expect(registry.verify("b", token)).toBeNull();
  });

  test("unregistered crews can't authenticate", () => {
    const registry = new CrewRegistry();
    const { token } = registry.register("a", { missionId: "m1", provider: "claude-code" });
    registry.unregister("a");
    expect(registry.verify("a", token)).toBeNull();
  });
});

describe("CrewRegistry persistence", () => {
  test("survives a restart when backed by a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mothership-crew-"));
    try {
      const file = join(dir, "crew.json");
      const first = new CrewRegistry(file);
      const { token } = first.register("a", { missionId: "m1", provider: "claude-code" });
      expect(statSync(file).mode & 0o777).toBe(0o600);

      const restarted = new CrewRegistry(file);
      expect(restarted.verify("a", token)).toEqual({ missionId: "m1", provider: "claude-code" });
      restarted.unregister("a");
      expect(new CrewRegistry(file).verify("a", token)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt file starts empty instead of crashing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mothership-crew-"));
    try {
      const file = join(dir, "crew.json");
      (await import("node:fs")).writeFileSync(file, "{nope");
      expect(new CrewRegistry(file).verify("a", "x")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("handleHookRequest", () => {
  test("accepts an authenticated hook and publishes the crew signal", async () => {
    const { token, published, deps } = setup();
    const res = await handleHookRequest(
      post(preToolUse, { "x-mothership-crew": "crew-1", "x-mothership-token": token }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(published).toEqual([
      {
        crewId: "crew-1",
        missionId: "m1",
        signal: { type: "working", activity: { tool: "Edit", filePath: "/work/repo/src/a.ts" } },
      },
    ]);
  });

  test("ignores events that don't change status", async () => {
    const { token, published, deps } = setup();
    const res = await handleHookRequest(
      post(
        { hook_event_name: "PostToolUse" },
        { "x-mothership-crew": "crew-1", "x-mothership-token": token },
      ),
      deps,
    );
    expect(res.status).toBe(204);
    expect(published).toEqual([]);
  });

  test.each([
    ["no headers", {}],
    ["a wrong token", { "x-mothership-crew": "crew-1", "x-mothership-token": "nope" }],
    ["an unknown crew", { "x-mothership-crew": "crew-9", "x-mothership-token": "nope" }],
  ])("rejects %s with 401", async (_, headers) => {
    const { published, deps } = setup();
    const res = await handleHookRequest(post(preToolUse, headers), deps);
    expect(res.status).toBe(401);
    expect(published).toEqual([]);
  });

  test("rejects malformed JSON with 400", async () => {
    const { token, deps } = setup();
    const res = await handleHookRequest(
      post("{nope", { "x-mothership-crew": "crew-1", "x-mothership-token": token }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  test("rejects oversized bodies with 413", async () => {
    const { token, deps } = setup();
    const res = await handleHookRequest(
      post(
        { hook_event_name: "Stop", padding: "x".repeat(1_100_000) },
        {
          "x-mothership-crew": "crew-1",
          "x-mothership-token": token,
        },
      ),
      deps,
    );
    expect(res.status).toBe(413);
  });

  test("a failing subscriber doesn't fail the hook", async () => {
    const { token, deps } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleHookRequest(
      post(
        { hook_event_name: "Stop" },
        { "x-mothership-crew": "crew-1", "x-mothership-token": token },
      ),
      {
        ...deps,
        publish: () => {
          throw new Error("boom");
        },
      },
    );
    expect(res.status).toBe(204);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
