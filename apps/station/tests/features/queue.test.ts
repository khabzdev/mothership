import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CrewLauncher, LaunchRequest } from "../../src/features/crew/launcher.server.ts";
import { CrewService } from "../../src/features/crew/service.server.ts";
import { QueueService } from "../../src/features/queue/queue.server.ts";
import { createDb } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  launches: LaunchRequest[] = [];
  async launch(r: LaunchRequest) {
    this.launches.push(r);
  }
  async write() {}
  async stop() {}
}

let scratch: string;
let crew: CrewService;
let queue: QueueService;
let claimed: number[];
/** Crew a pre-flight is still busy with (running, or a hand-back on the way). */
let unsettled: Set<string>;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "spaceship-queue-")));
  const repo = join(scratch, "shop");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "a"), "a");
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
    "i",
  ]);
  const db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "d", name: "shop", repoPath: repo, modules: [] }).run();
  crew = new CrewService({
    db,
    launcher: new FakeLauncher(),
    home: join(scratch, "home"),
    broadcast: () => {},
  });
  claimed = [];
  unsettled = new Set();
  queue = new QueueService({
    db,
    crew,
    claim: async (_d, n) => void claimed.push(n),
    isSettled: (id) => !unsettled.has(id),
  });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const add = (title: string, issueNumber?: number) =>
  queue.add("d", { title, prompt: `Do: ${title}`, ...(issueNumber && { issueNumber }) });

describe("task queue", () => {
  test("seats crew for queued tasks up to the deck's limit, in their own worktrees", async () => {
    await queue.setLimit("d", 2);
    await add("one", 12);
    await add("two");
    await add("three");
    expect(queue.list("d").map((t) => t.state)).toEqual(["running", "running", "queued"]);
    const roster = crew.roster("d");
    expect(roster.map((c) => c.task)).toEqual(["Do: one", "Do: two"]);
    expect(roster.every((c) => c.branch)).toBe(true);
    expect(claimed).toEqual([12]);
  });

  test("the next one starts when a running one's crew is done", async () => {
    await queue.setLimit("d", 1);
    await add("one");
    await add("two");
    const first = queue.list("d")[0]!;
    crew.handleSignal({ crewId: first.crewId!, signal: { type: "stopped" } });
    await queue.tick("d");
    expect(queue.list("d").map((t) => t.state)).toEqual(["done", "running"]);
  });

  test("crew that stopped aren't done while their pre-flight is busy", async () => {
    await queue.setLimit("d", 1);
    await add("one");
    await add("two");
    const first = queue.list("d")[0]!;
    unsettled.add(first.crewId!);
    crew.handleSignal({ crewId: first.crewId!, signal: { type: "stopped" } });
    await queue.tick("d");
    expect(queue.list("d").map((t) => t.state)).toEqual(["running", "queued"]);
    unsettled.delete(first.crewId!);
    await queue.tick("d");
    expect(queue.list("d").map((t) => t.state)).toEqual(["done", "running"]);
  });

  test("a limit of 0 pauses it, and an issue can't be queued twice", async () => {
    await queue.setLimit("d", 0);
    await add("one", 5);
    expect(queue.list("d")[0]!.state).toBe("queued");
    await expect(add("again", 5)).rejects.toThrow("already on the queue");
  });

  test("with every console taken, finished queue crew make room", async () => {
    await queue.setLimit("d", 16);
    for (let i = 0; i < 16; i++) await add(`task ${i}`);
    await add("seventeen");
    expect(queue.list("d").at(-1)!.state).toBe("queued");
    const first = queue.list("d")[0]!;
    // Paused, so its task is marked done without anyone taking the seat yet.
    await queue.setLimit("d", 0);
    crew.handleSignal({ crewId: first.crewId!, signal: { type: "stopped" } });
    await queue.tick("d");
    expect(queue.list("d")[0]!.state).toBe("done");
    // A pre-flight is busy with it again: it keeps its seat for now.
    unsettled.add(first.crewId!);
    await queue.setLimit("d", 16);
    expect(queue.list("d").at(-1)!.state).toBe("queued");
    expect(crew.roster("d").some((c) => c.id === first.crewId)).toBe(true);
    unsettled.delete(first.crewId!);
    await queue.tick("d");
    expect(queue.list("d").at(-1)!.state).toBe("running");
    expect(crew.roster("d").some((c) => c.id === first.crewId)).toBe(false);
    // Hiring 17 crew is slow when the whole workspace's tests run at once.
  }, 20_000);
});
