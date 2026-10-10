import { describe, expect, test } from "vite-plus/test";
import { runDiagnostics, type DiagnosticsDeps } from "../../src/app/diagnostics.server.ts";
import type { ExecResult } from "../../src/app/exec.server.ts";

type Script = Record<string, ExecResult>;

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const missing: ExecResult = { code: null, stdout: "", stderr: "", missing: true };

const healthy: Script = {
  "git --version": ok("git version 2.53.0\n"),
  "claude --version": ok("2.1.104 (Claude Code)\n"),
  "claude auth status --json": ok(
    JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      email: "secret@example.com",
      orgName: "Secret Org",
    }),
  ),
  "gh --version": ok("gh version 2.80.0 (2026-09-01)\n"),
  "gh auth status": ok(),
};

function deps(
  script: Script,
  ptyhost: DiagnosticsDeps["ptyhost"] = async () => ({}),
): DiagnosticsDeps {
  return {
    exec: async (command, args) => script[[command, ...args].join(" ")] ?? missing,
    ptyhost,
  };
}

const byId = async (d: DiagnosticsDeps) => {
  const result = await runDiagnostics(d);
  return { ...result, check: (id: string) => result.checks.find((c) => c.id === id)! };
};

describe("runDiagnostics", () => {
  test("a healthy station is ready for crew and launches", async () => {
    const { crewReady, launchReady, checks } = await byId(deps(healthy));
    expect(crewReady).toBe(true);
    expect(launchReady).toBe(true);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["git", "ok"],
      ["claude", "ok"],
      ["ptyhost", "ok"],
      ["gh", "ok"],
    ]);
  });

  test("reports versions and auth method but never account details", async () => {
    const { check } = await byId(deps(healthy));
    expect(check("claude").detail).toBe("2.1.104 · signed in via claude.ai");
    expect(check("git").detail).toBe("git version 2.53.0");
    expect(JSON.stringify(await runDiagnostics(deps(healthy)))).not.toMatch(/secret/i);
  });

  test("a missing claude takes crew offline with an install hint", async () => {
    const { check, crewReady, launchReady } = await byId(
      deps({ ...healthy, "claude --version": missing }),
    );
    expect(crewReady).toBe(false);
    expect(launchReady).toBe(true);
    expect(check("claude")).toMatchObject({
      status: "missing",
      fix: "Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash",
    });
  });

  test("a signed-out claude takes crew offline with a login hint", async () => {
    const { check, crewReady } = await byId(
      deps({
        ...healthy,
        "claude auth status --json": {
          code: 1,
          stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }),
          stderr: "",
        },
      }),
    );
    expect(crewReady).toBe(false);
    expect(check("claude")).toMatchObject({
      status: "unauthenticated",
      fix: "Run: claude auth login",
    });
  });

  test("unparseable auth output counts as signed out", async () => {
    const { check } = await byId(deps({ ...healthy, "claude auth status --json": ok("not json") }));
    expect(check("claude").status).toBe("unauthenticated");
  });

  test("gh problems only block launches", async () => {
    const signedOut = await byId(
      deps({ ...healthy, "gh auth status": { code: 1, stdout: "", stderr: "not logged in" } }),
    );
    expect(signedOut.crewReady).toBe(true);
    expect(signedOut.launchReady).toBe(false);
    expect(signedOut.check("gh")).toMatchObject({
      status: "unauthenticated",
      fix: "Run: gh auth login",
    });

    const absent = await byId(deps({ ...healthy, "gh --version": missing }));
    expect(absent.check("gh")).toMatchObject({
      status: "missing",
      fix: "Install the GitHub CLI: brew install gh",
    });
  });

  test("a missing git blocks everything", async () => {
    const { crewReady, launchReady, check } = await byId(
      deps({ ...healthy, "git --version": missing }),
    );
    expect(crewReady).toBe(false);
    expect(launchReady).toBe(false);
    expect(check("git").status).toBe("missing");
  });

  test("an unreachable PTY host takes crew offline", async () => {
    const { crewReady, check } = await byId(
      deps(healthy, async () => {
        throw new Error("PTY host did not start within 10000ms");
      }),
    );
    expect(crewReady).toBe(false);
    expect(check("ptyhost")).toMatchObject({
      status: "error",
      detail: "PTY host did not start within 10000ms",
      fix: "Build the PTY host: vp run -r build",
    });
  });

  test("an outdated PTY host still running crew takes crew offline with an upgrade hint", async () => {
    const { crewReady, check } = await byId(
      deps(healthy, async () => ({ outdated: true, liveSessions: 2 })),
    );
    expect(crewReady).toBe(false);
    expect(check("ptyhost")).toMatchObject({
      status: "error",
      detail: "Outdated PTY host is still running 2 crew",
      fix: "Let those crew finish (or stop them), then re-check to upgrade the PTY host",
    });
  });

  test("timeouts are errors, not crashes", async () => {
    const { check } = await byId(
      deps({
        ...healthy,
        "claude --version": { code: null, stdout: "", stderr: "", timedOut: true },
      }),
    );
    expect(check("claude")).toMatchObject({
      status: "error",
      detail: "claude --version timed out",
    });
  });
});

describe("crewBlocker", () => {
  test("is null when crew can launch", async () => {
    const { crewBlocker } = await import("../../src/app/diagnostics.ts");
    expect(crewBlocker(await runDiagnostics(deps(healthy)))).toBeNull();
  });

  test("explains the first crew check that fails, with its fix", async () => {
    const { crewBlocker } = await import("../../src/app/diagnostics.ts");
    const diagnostics = await runDiagnostics(
      deps({ ...healthy, "claude auth status --json": { code: 1, stdout: "{}", stderr: "" } }),
    );
    expect(crewBlocker(diagnostics)).toBe(
      "Crew offline: Claude Code 2.1.104 · not signed in. Run: claude auth login",
    );
  });

  test("ignores launch-only problems", async () => {
    const { crewBlocker } = await import("../../src/app/diagnostics.ts");
    expect(
      crewBlocker(await runDiagnostics(deps({ ...healthy, "gh --version": missing }))),
    ).toBeNull();
  });
});
