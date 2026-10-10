import type { ServerMsg } from "@mothership/protocol";
import { PROVIDERS } from "@mothership/providers";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { BriefService } from "../../src/features/briefs/briefs.server.ts";
import type { CrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewService, type PromptFrom } from "../../src/features/crew/service.server.ts";
import { readInspectionDiff } from "../../src/features/inspection/diff.server.ts";
import {
  InspectionService,
  MAX_REVIEWS,
  type InspectionDeps,
} from "../../src/features/inspection/inspection.server.ts";
import type { ReviewRun, RunReview } from "../../src/features/inspection/runner.server.ts";
import type { ChangedStat } from "../../src/features/inspection/scope.ts";
import { CheckService } from "../../src/features/preflight/checks.server.ts";
import { PreflightService } from "../../src/features/preflight/preflight.server.ts";
import type { RunCheck } from "../../src/features/preflight/runner.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import {
  briefs as briefsTable,
  crew as crewTable,
  deckChecks,
  decks,
  inspections,
} from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  writes: [string, string][] = [];
  fail = false;
  async launch() {}
  async write(crewId: string, data: string) {
    if (this.fail) throw new Error("pty closed");
    this.writes.push([crewId, data]);
  }
  async stop() {}
}

type ReviewOpts = Parameters<RunReview>[0];
type Raw = { severity: "blocker" | "note"; title: string; why: string; file?: string };

/** The `claude -p --output-format json` envelope around one fenced findings block. */
const envelope = (findings: Raw[]) =>
  JSON.stringify({ result: "```json\n" + JSON.stringify({ findings }) + "\n```" });

const ran = (findings: Raw[]): ReviewRun => ({
  ok: true,
  stdout: envelope(findings),
  exitCode: 0,
  timedOut: false,
  durationMs: 5,
});

const BLOCKER: Raw = { severity: "blocker", file: "a.ts", title: "Breaks login", why: "No token" };
const NOTE: Raw = { severity: "note", title: "Naming", why: "Could be clearer" };

let scratch: string;
let home: string;
let repo: string;
let db: Db;
let sent: ServerMsg[];
let launcher: FakeLauncher;
let crew: CrewService;
let checks: CheckService;
let briefs: BriefService;
let calls: ReviewOpts[];
/** What the next reviews answer, in order; a clean review once empty. */
let answers: ReviewRun[];
let run: RunReview;
let changes: { files: ChangedStat[]; diff: string };
let diffError: Error | null;
let print: { hash: string; commit: string };
let preflightResults: { name: string; verdict: "go" | "nogo" | "skipped" }[] | null;
let prompts: { crewId: string; from: PromptFrom }[];
let service: InspectionService;

function make(overrides: Partial<InspectionDeps> = {}) {
  return new InspectionService({
    db,
    crew,
    checks,
    briefs,
    preflight: {
      latest: () =>
        preflightResults
          ? ({ results: preflightResults } as ReturnType<InspectionDeps["preflight"]["latest"]>)
          : null,
      stopAttempts: () => 0,
    },
    providers: PROVIDERS,
    broadcast: (msg) => sent.push(msg),
    run: (o) => run(o),
    readDiff: async () => {
      if (diffError) throw diffError;
      return changes;
    },
    fingerprint: async () => print,
    homeRef: async () => "base",
    ...overrides,
  });
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-inspection-")));
  home = join(scratch, "home");
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
  sent = [];
  const broadcast = (msg: ServerMsg) => sent.push(msg);
  launcher = new FakeLauncher();
  crew = new CrewService({ db, launcher, broadcast, home });
  checks = new CheckService({ db, broadcast });
  briefs = new BriefService({
    db,
    crew,
    screens: { screen: async () => ({ cols: 80, rows: 0, lines: [] }) },
    broadcast,
    write: async () => {},
  });
  calls = [];
  answers = [];
  run = async (opts) => {
    calls.push(opts);
    return answers.shift() ?? ran([]);
  };
  changes = { files: [{ path: "a.ts", additions: 3, deletions: 1 }], diff: "+a\n" };
  diffError = null;
  print = { hash: "hash-1", commit: "c0ffee" };
  preflightResults = null;
  prompts = [];
  crew.onPrompt((e) => prompts.push(e));
  service = make();
  crew.describeWith((id) => ({ inspection: service.info(id) }));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const hire = async (consoleId = 0) =>
  crew.hire({ deckId: "deck-1", consoleId, task: "Fix", worktree: true });

const go = (crewId: string) => service.afterGo(crewId, print);

const signal = (crewId: string, sig: Parameters<CrewService["handleSignal"]>[0]["signal"]) => {
  crew.handleSignal({ crewId, signal: sig });
  service.handleSignal({ crewId, missionId: crewId, signal: sig });
};

const settled = (crewId: string) =>
  vi.waitFor(() => {
    const state = service.latest(crewId)?.state;
    if (!state || state === "running") throw new Error("still running");
  });

/** Wait until nothing is on the way for this crew member any more. */
const idle = (crewId: string) => vi.waitFor(() => expect(service.busy(crewId)).toBe(false));

const fuelOf = (crewId: string) =>
  db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()!;

const pastes = () => launcher.writes.filter(([, data]) => data.startsWith("\x1b[200~"));

const inspectionMsgs = () =>
  sent.filter(
    (m): m is Extract<ServerMsg, { type: "crew.inspection" }> => m.type === "crew.inspection",
  );

/** Reviews wait here until released (with an answer), or resolve as aborted. */
function holdReviews() {
  const held: ((answer?: ReviewRun) => void)[] = [];
  run = (opts) =>
    new Promise((resolve) => {
      calls.push(opts);
      held.push((answer) => resolve(answer ?? ran([])));
      opts.signal?.addEventListener("abort", () =>
        resolve({ ...ran([]), ok: false, error: "Aborted" }),
      );
    });
  return held;
}

const approvedBrief = (crewId: string, task: string, text: string) =>
  db
    .insert(briefsTable)
    .values({
      id: crypto.randomUUID(),
      deckId: "deck-1",
      crewId,
      revision: 1,
      text,
      state: "approved",
      approvedBy: "you",
      task,
    })
    .run();

describe("InspectionService", () => {
  test("a GO with a clean review clears, broadcasts and types nothing", async () => {
    const { id } = await hire();
    go(id);
    await settled(id);
    expect(service.history(id)).toHaveLength(1);
    expect(service.latest(id)).toMatchObject({
      crewId: id,
      deckId: "deck-1",
      flight: 1,
      attempt: 1,
      trigger: "stop",
      state: "cleared",
      fingerprint: "hash-1",
      commit: "c0ffee",
      findings: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      plan: { command: "claude", cwd: crew.workdir(id).cwd },
      timeoutMs: 300_000,
      signal: expect.any(AbortSignal),
    });
    expect(calls[0]!.prompt).toContain("Task (no approved brief):\n\nFix");
    const inspectionId = service.latest(id)!.id;
    expect(inspectionMsgs().at(-1)).toEqual({
      type: "crew.inspection",
      deckId: "deck-1",
      crewId: id,
      inspectionId,
      state: "cleared",
    });
    expect(inspectionMsgs().map((m) => m.state)).toContain("running");
    await new Promise((r) => setTimeout(r, 20));
    expect(pastes()).toEqual([]);
    expect(fuelOf(id).fuel).toBe(3);
  });

  test("a review blocker on a stop flags it and hands it back, spending fuel", async () => {
    const { id } = await hire();
    answers = [ran([BLOCKER, NOTE])];
    go(id);
    await settled(id);
    expect(service.latest(id)?.state).toBe("flagged");
    await vi.waitFor(() => expect(pastes()).toHaveLength(1));
    const data = pastes()[0]![1];
    expect(data).toContain("Inspector flagged your change (attempt 2 of 4):");
    expect(data).toContain("✗ a.ts Breaks login — No token");
    expect(data).toContain(
      "Fix these, then stop. Pre-flight and the Inspector run again when you stop.",
    );
    expect(data).not.toContain("Naming");
    expect(prompts).toEqual([{ crewId: id, from: "station" }]);
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(2));
  });

  test("attempts count this flight's finished stop inspections", async () => {
    const { id } = await hire();
    answers = [ran([BLOCKER])];
    go(id);
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(2));
    // A manual run in between counts for nothing.
    print = { hash: "hash-2", commit: "c0ffee" };
    answers = [ran([BLOCKER])];
    await service.inspect(id, "manual");
    await settled(id);
    print = { hash: "hash-3", commit: "c0ffee" };
    answers = [ran([BLOCKER])];
    go(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(3));
    await settled(id);
    await vi.waitFor(() => expect(pastes()).toHaveLength(2));
    expect(pastes()[1]![1]).toContain("(attempt 3 of 4)");
    expect(service.history(id).map((r) => [r.trigger, r.attempt])).toEqual([
      ["stop", 2],
      ["manual", 1],
      ["stop", 1],
    ]);
  });

  test("attempts are numbered with pre-flight's, which shares the fuel", async () => {
    const { id } = await hire();
    db.insert(deckChecks)
      .values({ id: "k", deckId: "deck-1", name: "test", command: "vp test", position: 0 })
      .run();
    checks.arm("deck-1", true);
    const verdicts: ("go" | "nogo")[] = ["nogo", "go"];
    const check: RunCheck = async (opts) => ({
      verdict: verdicts.shift() ?? "go",
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      output: "",
      logPath: opts.logPath,
    });
    const preflight = new PreflightService({
      db,
      crew,
      checks,
      broadcast: (msg) => sent.push(msg),
      home,
      run: check,
    });
    service = make({ preflight });
    preflight.onGo((crewId, p) => service.afterGo(crewId, p));
    const cwd = crew.workdir(id).cwd;
    const stopBoth = () => {
      crew.handleSignal({ crewId: id, signal: { type: "stopped" } });
      preflight.handleSignal({ crewId: id, missionId: id, signal: { type: "stopped" } });
      service.handleSignal({ crewId: id, missionId: id, signal: { type: "stopped" } });
    };

    // Attempt 1: pre-flight NO-GO, handed back (attempt 2 of 4).
    writeFileSync(join(cwd, "change.txt"), "one");
    stopBoth();
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(2));
    expect(service.latest(id)).toBeNull();

    // Attempt 2: pre-flight GO, then the Inspector flags it.
    answers = [ran([BLOCKER])];
    writeFileSync(join(cwd, "change.txt"), "two");
    stopBoth();
    await settled(id);
    expect(service.latest(id)).toMatchObject({ state: "flagged", attempt: 2 });
    await vi.waitFor(() => expect(pastes()).toHaveLength(2));
    expect(pastes()[1]![1]).toContain("Inspector flagged your change (attempt 3 of 4):");
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(1));
  });

  test("an empty tank raises needs you instead", async () => {
    const { id } = await hire();
    db.update(crewTable).set({ fuel: 0 }).where(eq(crewTable.id, id)).run();
    answers = [ran([BLOCKER])];
    go(id);
    await settled(id);
    await vi.waitFor(() => expect(crew.member(id).status).toBe("needs_input"));
    expect(crew.member(id).detail).toBe("Inspector flagged: Breaks login");
    expect(pastes()).toEqual([]);
    expect(service.busy(id)).toBe(false);
  });

  test("nothing is typed into a permission prompt, and no fuel is spent", async () => {
    const { id } = await hire();
    const held = holdReviews();
    go(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    crew.handleSignal({ crewId: id, signal: { type: "needsInput", detail: "Approve Bash: ls" } });
    held.shift()!(ran([BLOCKER]));
    await settled(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(service.latest(id)?.state).toBe("flagged");
    expect(pastes()).toEqual([]);
    expect(fuelOf(id).fuel).toBe(3);
    expect(crew.member(id)).toMatchObject({ status: "needs_input", detail: "Approve Bash: ls" });
  });

  test("a manual inspection that flags types nothing and spends no fuel", async () => {
    const { id } = await hire();
    answers = [ran([BLOCKER])];
    expect(await service.inspect(id, "manual")).toEqual(expect.any(String));
    await settled(id);
    expect(service.latest(id)).toMatchObject({ trigger: "manual", state: "flagged", attempt: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(pastes()).toEqual([]);
    expect(fuelOf(id).fuel).toBe(3);
  });

  test("an empty diff clears without a review", async () => {
    const { id } = await hire();
    changes = { files: [], diff: "" };
    go(id);
    await settled(id);
    expect(service.latest(id)).toMatchObject({ state: "cleared", findings: [] });
    expect(calls).toEqual([]);
  });

  test("a review that can't run is cancelled as failed, spending nothing", async () => {
    const { id } = await hire();
    answers = [
      { ok: false, stdout: "", exitCode: null, timedOut: true, error: "Timed out", durationMs: 1 },
    ];
    go(id);
    await settled(id);
    const record = service.latest(id)!;
    expect(record.state).toBe("cancelled");
    expect(record.reason).toBe("failed: Timed out");
    expect(inspectionMsgs().at(-1)).toMatchObject({ state: "cancelled", failed: "Timed out" });
    expect(fuelOf(id).fuel).toBe(3);
    expect(pastes()).toEqual([]);
  });

  test("a review whose envelope says it errored is cancelled as failed, spending nothing", async () => {
    const { id } = await hire();
    answers = [
      {
        ok: true,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          result: "Credit balance is too low",
        }),
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
      },
    ];
    go(id);
    await settled(id);
    const record = service.latest(id)!;
    expect(record).toMatchObject({
      state: "cancelled",
      reason: "failed: Credit balance is too low",
      findings: [],
    });
    expect(inspectionMsgs().at(-1)).toMatchObject({
      state: "cancelled",
      failed: "Credit balance is too low",
    });
    expect(fuelOf(id).fuel).toBe(3);
    expect(pastes()).toEqual([]);
  });

  test("a diff that can't be read is cancelled as failed", async () => {
    const { id } = await hire();
    diffError = new Error("fatal: bad revision");
    go(id);
    await settled(id);
    expect(service.latest(id)).toMatchObject({
      state: "cancelled",
      reason: "failed: fatal: bad revision",
    });
    expect(inspectionMsgs().at(-1)).toMatchObject({ failed: "fatal: bad revision" });
    expect(calls).toEqual([]);
  });

  test("going back to work mid-review cancels it as superseded, typing nothing after", async () => {
    const { id } = await hire();
    let release!: (answer: ReviewRun) => void;
    let aborted: AbortSignal | undefined;
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        aborted = opts.signal;
        release = resolve;
      });
    go(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    signal(id, { type: "working" });
    expect(aborted?.aborted).toBe(true);
    expect(service.latest(id)).toMatchObject({ state: "cancelled", reason: "superseded" });
    expect(inspectionMsgs().at(-1)).toMatchObject({ state: "cancelled" });
    expect(inspectionMsgs().at(-1)).not.toHaveProperty("failed");
    release(ran([BLOCKER]));
    await new Promise((r) => setTimeout(r, 20));
    expect(service.latest(id)?.state).toBe("cancelled");
    expect(pastes()).toEqual([]);
    expect(fuelOf(id).fuel).toBe(3);
    expect(service.busy(id)).toBe(false);
  });

  test("your prompt, or sending it home, cancels a running inspection", async () => {
    const { id } = await hire();
    holdReviews();
    go(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await crew.prompt(id, "try something else");
    expect(service.latest(id)).toMatchObject({ state: "cancelled", reason: "superseded" });

    const other = await hire(1);
    go(other.id);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await crew.sendHome(other.id, "keep");
    expect(service.latest(other.id)).toMatchObject({ state: "cancelled", reason: "superseded" });
  });

  test("a worktree gone mid-review is cancelled quietly", async () => {
    const { id } = await hire();
    const held = holdReviews();
    go(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    rmSync(crew.workdir(id).cwd, { recursive: true, force: true });
    held.shift()!(ran([BLOCKER]));
    await settled(id);
    expect(service.latest(id)).toMatchObject({ state: "cancelled", reason: "worktree gone" });
    expect(inspectionMsgs().at(-1)).not.toHaveProperty("failed");
    expect(pastes()).toEqual([]);
  });

  describe("a deck whose checks aren't armed", () => {
    test("a stop with changes is inspected", async () => {
      const { id } = await hire();
      signal(id, { type: "stopped" });
      await settled(id);
      expect(service.latest(id)).toMatchObject({ trigger: "stop", state: "cleared" });
      expect(calls).toHaveLength(1);
    });

    test("a stop with no changes isn't", async () => {
      const { id } = await hire();
      changes = { files: [], diff: "" };
      signal(id, { type: "stopped" });
      await idle(id);
      await new Promise((r) => setTimeout(r, 20));
      expect(service.latest(id)).toBeNull();
      expect(service.busy(id)).toBe(false);
    });

    test("a stop while its brief is still being planned isn't", async () => {
      const { id } = await hire();
      briefs.handleSignal({
        crewId: id,
        missionId: id,
        signal: { type: "plan", plan: "## Goal\nX" },
      });
      signal(id, { type: "stopped" });
      await new Promise((r) => setTimeout(r, 20));
      expect(service.latest(id)).toBeNull();
    });

    test("armed with no checks on counts as not armed", async () => {
      const { id } = await hire();
      checks.arm("deck-1", true);
      signal(id, { type: "stopped" });
      await settled(id);
      expect(service.latest(id)?.state).toBe("cleared");
    });

    test("armed with checks on leaves the stop to pre-flight", async () => {
      const { id } = await hire();
      db.insert(deckChecks)
        .values({ id: "k", deckId: "deck-1", name: "test", command: "vp test", position: 0 })
        .run();
      checks.arm("deck-1", true);
      signal(id, { type: "stopped" });
      await new Promise((r) => setTimeout(r, 20));
      expect(service.latest(id)).toBeNull();
    });
  });

  test("with the deck's Inspector off, nothing is inspected", async () => {
    const { id } = await hire();
    service.setEnabled("deck-1", false);
    expect(service.enabled("deck-1")).toBe(false);
    expect(sent.at(-1)).toMatchObject({ type: "deck.checks", deckId: "deck-1", inspector: false });
    go(id);
    signal(id, { type: "stopped" });
    expect(await service.inspect(id, "manual")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(service.latest(id)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("switched off mid-review, the run finishes without a hand-back", async () => {
    const { id } = await hire();
    const held = holdReviews();
    go(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    service.setEnabled("deck-1", false);
    held.shift()!(ran([BLOCKER]));
    await settled(id);
    expect(service.latest(id)?.state).toBe("flagged");
    await new Promise((r) => setTimeout(r, 20));
    expect(pastes()).toEqual([]);
    expect(fuelOf(id).fuel).toBe(3);
    expect(service.busy(id)).toBe(false);
  });

  test("an unchanged stop after a flagged stop needs you, without another review", async () => {
    const { id } = await hire();
    answers = [ran([BLOCKER])];
    go(id);
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(2));
    go(id);
    await vi.waitFor(() =>
      expect(crew.member(id)).toMatchObject({
        status: "needs_input",
        detail: `Inspector flagged: Breaks login; ${crew.member(id).name} stopped without changes`,
      }),
    );
    expect(calls).toHaveLength(1);
    expect(service.history(id)).toHaveLength(1);
    expect(fuelOf(id).fuel).toBe(2);
  });

  test("an unchanged stop after a clear runs nothing; after a cancel it runs again", async () => {
    const { id } = await hire();
    go(id);
    await settled(id);
    go(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);

    db.update(inspections).set({ state: "cancelled" }).run();
    go(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(2));
    await settled(id);
    expect(calls).toHaveLength(2);
  });

  test("scope uses only the brief approved for the current task", async () => {
    const { id } = await hire();
    changes = {
      files: ["x.ts", "y.ts", "z.ts"].map((path) => ({ path, additions: 1, deletions: 0 })),
      diff: "+x\n",
    };
    approvedBrief(id, "An older task", "## Goal\nOld.\n\n## Files\n- src/old.ts\n");
    go(id);
    await settled(id);
    expect(service.latest(id)).toMatchObject({ state: "cleared", findings: [] });
    expect(service.latest(id)).not.toHaveProperty("briefId");
    expect(calls[0]!.prompt).toContain("Task (no approved brief)");

    // The brief for its own task: three files outside it are a blocker.
    approvedBrief(id, "Fix", "## Goal\nFix.\n\n## Files\n- src/fix.ts\n");
    print = { hash: "hash-2", commit: "c0ffee" };
    go(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(2));
    await settled(id);
    const record = service.latest(id)!;
    expect(record.state).toBe("flagged");
    expect(record.briefId).toEqual(expect.any(String));
    expect(record.findings[0]).toMatchObject({ severity: "note", source: "scope" });
    expect(record.findings.some((f) => f.severity === "blocker" && f.source === "scope")).toBe(
      true,
    );
    expect(calls[1]!.prompt).toContain("Approved brief:\n\n## Goal\nFix.");
  });

  test("the review hears the latest pre-flight results, when the deck's checks are armed", async () => {
    const { id } = await hire();
    preflightResults = [{ name: "test", verdict: "go" }];
    checks.arm("deck-1", true);
    go(id);
    await settled(id);
    expect(calls[0]!.prompt).toContain("- test: go");
  });

  test(`one review at a time across the station (MAX_REVIEWS = ${MAX_REVIEWS})`, async () => {
    const a = await hire(0);
    const b = await hire(1);
    const held = holdReviews();
    go(a.id);
    go(b.id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await vi.waitFor(() => expect(service.latest(b.id)?.state).toBe("running"));
    expect(service.info(a.id)).toEqual({ state: "running", blockers: 0, notes: 0 });
    expect(service.info(b.id)).toEqual({ state: "running", blockers: 0, notes: 0, queued: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    held.shift()!();
    await settled(a.id);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(service.info(b.id)).not.toHaveProperty("queued");
    held.shift()!();
    await settled(b.id);
    expect(service.latest(b.id)?.state).toBe("cleared");
  });

  test("a queued inspection cancelled before its turn never runs", async () => {
    const a = await hire(0);
    const b = await hire(1);
    const held = holdReviews();
    go(a.id);
    go(b.id);
    await vi.waitFor(() => expect(service.latest(b.id)?.state).toBe("running"));
    service.cancel(b.id);
    expect(service.latest(b.id)).toMatchObject({ state: "cancelled", reason: "superseded" });
    held.shift()!();
    await settled(a.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
  });

  test("reconcile marks leftover running rows cancelled for a restart", async () => {
    const { id } = await hire();
    db.insert(inspections)
      .values({
        id: "i-stale",
        deckId: "deck-1",
        crewId: id,
        flight: 1,
        attempt: 1,
        trigger: "stop",
        fingerprint: "h",
        commit: "c",
      })
      .run();
    service.reconcile();
    expect(service.latest(id)).toMatchObject({
      id: "i-stale",
      state: "cancelled",
      reason: "restart",
    });
    expect(service.latest(id)?.finishedAt).toEqual(expect.any(Number));
  });

  test("info counts blockers and notes; a newer flight with no run shows nothing", async () => {
    const { id } = await hire();
    answers = [ran([NOTE, BLOCKER, { ...BLOCKER, title: "Second" }])];
    go(id);
    await settled(id);
    expect(service.info(id)).toEqual({
      state: "flagged",
      blockers: 2,
      notes: 1,
      firstBlocker: "Breaks login",
    });
    expect(crew.member(id).inspection).toEqual(service.info(id));
    db.update(crewTable).set({ flight: 2 }).where(eq(crewTable.id, id)).run();
    expect(service.info(id)).toBeUndefined();
    expect(service.history(id)).toEqual([]);
    expect(service.latest(id)?.flight).toBe(1);
  });

  test("busy while an inspection is on the way, and while a hand-back is coming", async () => {
    const { id } = await hire();
    expect(service.busy(id)).toBe(false);
    const held = holdReviews();
    go(id);
    expect(service.busy(id)).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    held.shift()!();
    await settled(id);
    await vi.waitFor(() => expect(service.busy(id)).toBe(false));

    run = async (opts) => {
      calls.push(opts);
      return ran([BLOCKER]);
    };
    print = { hash: "hash-2", commit: "c0ffee" };
    crew.handleSignal({ crewId: id, signal: { type: "stopped" } });
    go(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(2));
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id).fuel).toBe(2));
    expect(service.busy(id)).toBe(true);
    crew.handleExit(id);
    expect(service.busy(id)).toBe(false);
  });

  test("shells and crew in the deck's checkout are never inspected", async () => {
    const shell = await crew.openShell({ deckId: "deck-1", consoleId: 0 });
    const shared = await crew.hire({
      deckId: "deck-1",
      consoleId: 1,
      task: "Fix",
      worktree: false,
    });
    for (const id of [shell.id, shared.id]) {
      go(id);
      expect(await service.inspect(id, "manual")).toBeNull();
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(db.select().from(inspections).all()).toEqual([]);
  });

  test("a hand-back that can't be typed is treated as out of fuel", async () => {
    const { id } = await hire();
    answers = [ran([BLOCKER])];
    launcher.fail = true;
    go(id);
    await settled(id);
    await vi.waitFor(() => expect(crew.member(id).status).toBe("needs_input"));
    expect(crew.member(id).detail).toBe(
      "Inspector flagged: Breaks login (couldn't reach the agent)",
    );
    expect(fuelOf(id).fuel).toBe(3);
  });
});

describe("readInspectionDiff", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
      .toString()
      .trim();

  test("everything since the base, committed, uncommitted and untracked", async () => {
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-qb", "work");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "done.ts"), "one\ntwo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "work");
    writeFileSync(join(repo, "README.md"), "hello\n");
    writeFileSync(join(repo, "new.ts"), "fresh\n");

    const { files, diff } = await readInspectionDiff(repo, base);
    expect(files).toEqual([
      { path: "new.ts", additions: 1, deletions: 0 },
      { path: "README.md", additions: 1, deletions: 1 },
      { path: "src/done.ts", additions: 2, deletions: 0 },
    ]);
    expect(diff).toContain("+hello");
    expect(diff).toContain("+fresh");
    expect(diff).toContain("+two");
  });

  test("nothing changed is nothing", async () => {
    expect(await readInspectionDiff(repo, git(repo, "rev-parse", "HEAD"))).toEqual({
      files: [],
      diff: "",
    });
  });
});
