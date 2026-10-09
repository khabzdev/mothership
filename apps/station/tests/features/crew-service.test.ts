import type { ServerMsg } from "@mothership/protocol";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { CrewLauncher, LaunchRequest } from "../../src/features/crew/launcher.server.ts";
import { parseHireInput, parsePromptInput } from "../../src/features/crew/model.ts";
import { CrewService } from "../../src/features/crew/service.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  launches: LaunchRequest[] = [];
  writes: [string, string][] = [];
  failWith: Error | null = null;
  async launch(r: LaunchRequest) {
    if (this.failWith) throw this.failWith;
    this.launches.push(r);
  }
  async write(crewId: string, data: string) {
    this.writes.push([crewId, data]);
  }
}

let scratch: string;
let repo: string;
let db: Db;
let launcher: FakeLauncher;
let rosters: Extract<ServerMsg, { type: "crew.roster" }>[];
let service: CrewService;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-crew-")));
  repo = join(scratch, "shop");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "hi");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "init",
  ]);
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  launcher = new FakeLauncher();
  rosters = [];
  service = new CrewService({
    db,
    launcher,
    home: join(scratch, "home"),
    broadcast: (msg) => msg.type === "crew.roster" && rosters.push(msg),
  });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const hire = (consoleId: number, task = "Add dark mode", worktree = false) =>
  service.hire({ deckId: "deck-1", consoleId, task, worktree });

describe("hire", () => {
  test("seats a starting crew member at the console and launches it in the repo", async () => {
    const nova = await hire(3);
    expect(nova).toMatchObject({
      deckId: "deck-1",
      consoleId: 3,
      name: "Nova",
      task: "Add dark mode",
      status: "starting",
    });
    expect(launcher.launches).toEqual([
      {
        crewId: nova.id,
        missionId: nova.id,
        provider: "claude-code",
        prompt: "Add dark mode",
        cwd: repo,
      },
    ]);
    expect(rosters.at(-1)?.crew.map((c) => c.name)).toEqual(["Nova"]);
  });

  test("names are handed out in order and reused per deck", async () => {
    expect((await hire(0)).name).toBe("Nova");
    expect((await hire(1)).name).toBe("Comet");
  });

  test("with a worktree, works on its own branch", async () => {
    const nova = await hire(2, "Add dark mode", true);
    expect(nova.branch).toMatch(/^mothership\/add-dark-mode-/);
    expect(launcher.launches[0]!.cwd).toContain(join(scratch, "home", "worktrees"));
  });

  test("a taken console can't be hired twice", async () => {
    await hire(5);
    await expect(hire(5)).rejects.toThrow("Console 6 is taken");
  });

  test("a failed launch frees the console again", async () => {
    launcher.failWith = new Error("Command not found: claude");
    await expect(hire(1)).rejects.toThrow("Command not found: claude");
    expect(service.roster("deck-1")).toEqual([]);
  });

  test("an unknown deck is rejected", async () => {
    await expect(
      service.hire({ deckId: "nope", consoleId: 0, task: "", worktree: false }),
    ).rejects.toThrow("No such deck");
  });
});

describe("signals", () => {
  test("hooks drive status, action and detail like agent-office", async () => {
    const { id } = await hire(0);
    const status = () => service.roster("deck-1")[0]!;

    service.handleSignal({ crewId: id, signal: { type: "idle" } });
    expect(status().status).toBe("idle");

    service.handleSignal({
      crewId: id,
      signal: { type: "working", activity: { tool: "Edit", filePath: "/a.ts" } },
    });
    expect(status()).toMatchObject({ status: "working", action: "edit" });

    service.handleSignal({
      crewId: id,
      signal: { type: "working", activity: { tool: "Bash", command: "vp test" } },
    });
    expect(status().action).toBe("test");

    service.handleSignal({
      crewId: id,
      signal: { type: "needsInput", detail: "Approve Bash: rm -rf dist" },
    });
    expect(status()).toMatchObject({ status: "needs_input", detail: "Approve Bash: rm -rf dist" });
    expect(status().action).toBeUndefined();

    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    expect(status()).toMatchObject({ status: "done" });
    expect(status().detail).toBeUndefined();

    service.handleSignal({ crewId: id, signal: { type: "ended", reason: "other" } });
    expect(status().status).toBe("asleep");
  });

  test("statusSince only moves when the status changes", async () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const { id } = await hire(0);
      vi.setSystemTime(5_000);
      service.handleSignal({ crewId: id, signal: { type: "working" } });
      vi.setSystemTime(9_000);
      service.handleSignal({ crewId: id, signal: { type: "working", activity: { tool: "Read" } } });
      expect(service.roster("deck-1")[0]!.statusSince).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a crew process exiting puts it to sleep", async () => {
    const { id } = await hire(0);
    service.handleExit(id);
    expect(service.roster("deck-1")[0]!.status).toBe("asleep");
  });

  test("signals for unknown crew are ignored", () => {
    expect(() => service.handleSignal({ crewId: "ghost", signal: { type: "idle" } })).not.toThrow();
  });

  test("reconcile puts crew whose session is gone to sleep", async () => {
    const a = await hire(0);
    const b = await hire(1);
    service.reconcile([{ id: b.id, exited: false }]);
    const byId = Object.fromEntries(service.roster("deck-1").map((c) => [c.id, c.status]));
    expect(byId).toEqual({ [a.id]: "asleep", [b.id]: "starting" });
  });
});

describe("prompt", () => {
  test("pastes the text, then presses Enter", async () => {
    vi.useFakeTimers();
    try {
      const { id } = await hire(0);
      await service.prompt(id, "Also add tests");
      expect(launcher.writes).toEqual([[id, "\x1b[200~Also add tests\x1b[201~"]]);
      await vi.advanceTimersByTimeAsync(150);
      expect(launcher.writes.at(-1)).toEqual([id, "\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("unknown crew can't be prompted", async () => {
    await expect(service.prompt("ghost", "hi")).rejects.toThrow("No such crew member");
  });
});

describe("input parsing", () => {
  test("hire input", () => {
    expect(parseHireInput({ deckId: "d", consoleId: 4, task: "  go  ", worktree: true })).toEqual({
      deckId: "d",
      consoleId: 4,
      task: "go",
      worktree: true,
    });
    expect(() => parseHireInput({ deckId: "d", consoleId: 16 })).toThrow("consoleId must be 0–15");
  });

  test("prompt input", () => {
    expect(parsePromptInput({ crewId: "c", text: " hi\r\nthere " })).toEqual({
      crewId: "c",
      text: "hi\nthere",
    });
    expect(() => parsePromptInput({ crewId: "c", text: "  " })).toThrow("Empty prompt");
  });
});
