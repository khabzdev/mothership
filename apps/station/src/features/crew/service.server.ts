import type {
  BriefInfo,
  CrewInfo,
  CrewStatus,
  InspectionInfo,
  PreflightInfo,
  RankInfo,
  ServerMsg,
} from "@spaceship/protocol";
import type { CrewSignal } from "@spaceship/providers";
import { and, asc, eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { BRIEF_INSTRUCTIONS } from "../briefs/model";
import { lessonsPrompt } from "../debrief/model";
import { crew, decks } from "../../shared/db/schema";
import { toolAction } from "./actions";
import type { CrewLauncher } from "./launcher.server";
import {
  CREW_CHARACTERS,
  CREW_COLORS,
  CREW_NAMES,
  type HireInput,
  type WorktreeChoice,
} from "./model";
import { SUBMIT_DELAY_MS, bracketedPaste } from "./paste";
import {
  branchName,
  createWorktree,
  removeWorktree,
  worktreeState,
  type WorktreeState,
} from "./worktree.server";

export interface CrewServiceDeps {
  db: Db;
  launcher: CrewLauncher;
  broadcast: (msg: ServerMsg) => void;
  /** Spaceship home; worktrees live under `<home>/worktrees`. */
  home: string;
}

type Row = typeof crew.$inferSelect;

const STATUS_FOR_SIGNAL: Record<CrewSignal["type"], CrewStatus> = {
  idle: "idle",
  working: "working",
  needsInput: "needs_input",
  plan: "needs_input",
  stopped: "done",
  ended: "asleep",
};

/**
 * A mission ending: its pull request opened (O), or the crew member sent home (X). Listeners
 * read the mission's rows from `missionSince` up to `endedAt`.
 */
export interface MissionEnd {
  crewId: string;
  deckId: string;
  name: string;
  task: string;
  missionSince: number;
  endedAt: number;
  how: "pr" | "home";
  prUrl?: string;
  branch?: string;
  provider: string;
  ownWorktree: boolean;
}

/** Who typed a prompt: you, or the station handing pre-flight failures back. */
export type PromptFrom = "you" | "station";

/** What other services add to a crew member's roster entry. */
type Describe = (crewId: string) => {
  preflight?: PreflightInfo;
  brief?: BriefInfo;
  inspection?: InspectionInfo;
  rank?: RankInfo;
  patches?: string[];
};
type Busy = (crewId: string) => boolean;
type Briefed = (crewId: string) => boolean;
type Lessons = (deckId: string) => string[];

function toInfo(row: Row, describe?: Describe): CrewInfo {
  const { preflight, brief, inspection, rank, patches } = describe?.(row.id) ?? {};
  return {
    id: row.id,
    kind: row.provider === "shell" ? "shell" : "agent",
    deckId: row.deckId,
    consoleId: row.consoleId,
    name: row.name,
    color: row.color,
    character: row.character,
    task: row.task,
    status: row.status,
    statusSince: row.statusSince,
    ...(row.action && { action: row.action }),
    ...(row.detail && { detail: row.detail }),
    ...(row.branch && { branch: row.branch }),
    ...(row.prUrl && { prUrl: row.prUrl }),
    ...(preflight && { preflight }),
    ...(brief && { brief }),
    ...(inspection && { inspection }),
    ...(rank && { rank }),
    ...(patches && patches.length > 0 && { patches }),
  };
}

/** Crew at consoles: hiring, prompting, and keeping their status in step with their hooks. */
export class CrewService {
  readonly #deps: CrewServiceDeps;
  readonly #goneListeners = new Set<(crewId: string) => void>();
  readonly #exitListeners = new Set<(crewId: string) => void>();
  readonly #promptListeners = new Set<(e: { crewId: string; from: PromptFrom }) => void>();
  readonly #missionEndListeners = new Set<(end: MissionEnd) => void>();
  #describe: Describe | undefined;
  #busy: Busy = () => false;
  #briefWaiting: Briefed = () => false;
  #briefUnapproved: Briefed = () => false;
  #lessons: Lessons = () => [];
  /** Crew with a prompt typed by the station or the app, whose submit hook is still to come. */
  readonly #submitting = new Set<string>();
  /** Crew under a station alert, which stands until they work again. */
  readonly #alerted = new Set<string>();
  /** Crew whose "needs you" is only Claude idling at its prompt, not a question for you. */
  readonly #idleWaiting = new Set<string>();

  constructor(deps: CrewServiceDeps) {
    this.#deps = deps;
  }

  roster(deckId: string): CrewInfo[] {
    return this.#deps.db
      .select()
      .from(crew)
      .where(eq(crew.deckId, deckId))
      .orderBy(asc(crew.consoleId))
      .all()
      .map((row) => this.#info(row));
  }

  /** Add each crew member's pre-flight, brief, inspection and rank to what the roster says about it. */
  describeWith(fn: Describe): void {
    this.#describe = fn;
  }

  /** Ask whether a pre-flight is busy with a crew member, so Claude's idle nudge doesn't count. */
  busyWith(fn: Busy): void {
    this.#busy = fn;
  }

  /** Ask whether a crew member's brief waits on its approval dialog, where Enter would answer it. */
  briefWaitingWith(fn: Briefed): void {
    this.#briefWaiting = fn;
  }

  /** Ask whether a crew member has briefs, none of them approved, so a resume plans again. */
  briefUnapprovedWith(fn: Briefed): void {
    this.#briefUnapproved = fn;
  }

  /** Ask for a deck's kept lessons, which every Claude launch there carries as instructions. */
  lessonsWith(fn: Lessons): void {
    this.#lessons = fn;
  }

  /** The `instructions` option for a launch: the deck's kept lessons; none for a shell. */
  #lessonsFor(deckId: string, provider: string): { instructions?: string } {
    if (provider !== "claude-code") return {};
    const instructions = lessonsPrompt(this.#lessons(deckId));
    return instructions ? { instructions } : {};
  }

  /** Whether a crew member's "needs you" is only Claude idling at its prompt (safe to type into). */
  waitingIdle(crewId: string): boolean {
    return this.#idleWaiting.has(crewId);
  }

  /** Send the deck's roster again, after something it describes has changed. */
  refresh(deckId: string): void {
    this.#broadcast(deckId);
  }

  /** Raise "needs you" over a crew member, saying why; it stands until the crew member works again. */
  alert(crewId: string, detail: string): void {
    if (!this.#row(crewId)) return;
    this.#alerted.add(crewId);
    this.#idleWaiting.delete(crewId);
    this.#update(crewId, "needs_input", { action: null, detail });
  }

  member(crewId: string): CrewInfo {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    return this.#info(row);
  }

  /** Where a crew member works, and whether that's a worktree of its own or the deck's checkout. */
  workdir(crewId: string): { cwd: string; repoPath: string; ownWorktree: boolean } {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    const { repoPath } = this.#deck(row.deckId);
    return { cwd: row.cwd, repoPath, ownWorktree: !!row.branch && row.cwd !== repoPath };
  }

  /** Remember a crew member's pull request, so O shows it from then on. */
  setPr(crewId: string, prUrl: string): void {
    const row = this.#row(crewId);
    if (!row) return;
    this.#deps.db.update(crew).set({ prUrl }).where(eq(crew.id, crewId)).run();
    this.#broadcast(row.deckId);
  }

  /** Its pull request opened: the mission ends, and whatever it does next is a new one. */
  endMission(crewId: string, how: "pr", pr: { url: string; branch: string }): void {
    const row = this.#row(crewId);
    if (!row) return;
    const endedAt = Date.now();
    this.#endMission(row, { how, endedAt, prUrl: pr.url, branch: pr.branch });
    this.#deps.db.update(crew).set({ missionSince: endedAt }).where(eq(crew.id, crewId)).run();
  }

  /** Called when a mission ends, while its crew member's row still exists. */
  onMissionEnd(listener: (end: MissionEnd) => void): () => void {
    this.#missionEndListeners.add(listener);
    return () => this.#missionEndListeners.delete(listener);
  }

  #endMission(row: Row, end: Pick<MissionEnd, "how" | "endedAt" | "prUrl" | "branch">): void {
    const { repoPath } = this.#deck(row.deckId);
    const event: MissionEnd = {
      crewId: row.id,
      deckId: row.deckId,
      name: row.name,
      task: row.task,
      missionSince: row.missionSince,
      provider: row.provider,
      ownWorktree: !!row.branch && row.cwd !== repoPath,
      ...end,
    };
    for (const listener of this.#missionEndListeners) {
      // A listener that fails mustn't stop the pull request or the send-home.
      try {
        listener(event);
      } catch (error) {
        console.error(`[crew] mission end listener failed for ${row.name}`, error);
      }
    }
  }

  async hire(input: HireInput): Promise<CrewInfo> {
    return this.#seat(input, "claude-code");
  }

  /** A plain shell at an empty console, in the deck's own checkout (agent-office's B). */
  async openShell(input: { deckId: string; consoleId: number }): Promise<CrewInfo> {
    const member = await this.#seat({ ...input, task: "", worktree: false }, "shell");
    // A shell has no hooks: it's ready as soon as it's running.
    this.#update(member.id, "idle", { action: null, detail: null });
    return this.#info(this.#row(member.id)!);
  }

  /** Wake an asleep crew member: resume its agent's session, or restart its shell (R). */
  async resume(crewId: string): Promise<CrewInfo> {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    if (row.status !== "asleep") throw new Error(`${row.name} is still running`);
    if (!existsSync(row.cwd)) throw new Error(`${row.name}'s worktree is gone: ${row.cwd}`);
    const shell = row.provider === "shell";
    // Briefed but not yet approved, it resumes planning: without plan mode its first edit would
    // land. Crew with no brief (hired before briefs) resume as they were.
    const plan =
      row.provider === "claude-code" && !!row.task.trim() && this.#briefUnapproved(crewId);
    this.#update(crewId, shell ? "idle" : "starting", { action: null, detail: null });
    try {
      await this.#deps.launcher.launch({
        crewId,
        missionId: crewId,
        provider: row.provider,
        prompt: "",
        cwd: row.cwd,
        ...(row.sessionId && !shell && { resume: row.sessionId }),
        ...(plan && { plan: { instructions: BRIEF_INSTRUCTIONS } }),
        ...this.#lessonsFor(row.deckId, row.provider),
      });
    } catch (error) {
      this.#update(crewId, "asleep", { action: null, detail: null });
      throw error;
    }
    return this.#info(this.#row(crewId)!);
  }

  async #seat(input: HireInput, provider: string): Promise<CrewInfo> {
    const { db, home, launcher } = this.#deps;
    const deck = db.select().from(decks).where(eq(decks.id, input.deckId)).get();
    if (!deck) throw new Error(`No such deck: ${input.deckId}`);
    const taken = db
      .select()
      .from(crew)
      .where(and(eq(crew.deckId, deck.id), eq(crew.consoleId, input.consoleId)))
      .get();
    if (taken) throw new Error(`Console ${input.consoleId + 1} is taken by ${taken.name}`);

    const id = crypto.randomUUID();
    const used = new Set(this.roster(deck.id).map((c) => c.name));
    const index = CREW_NAMES.findIndex((n) => !used.has(n));
    const name = index >= 0 ? CREW_NAMES[index]! : `Crew ${used.size + 1}`;
    const slot = index >= 0 ? index : used.size;

    let cwd = deck.repoPath;
    let branch: string | null = null;
    if (input.worktree) {
      const worktree = await createWorktree({
        repoPath: deck.repoPath,
        path: join(home, "worktrees", `${deck.name}-${deck.id.slice(0, 8)}`, id.slice(0, 8)),
        branch: branchName(input.task || name, id),
      });
      cwd = worktree.path;
      branch = worktree.branch;
    }

    db.insert(crew)
      .values({
        id,
        deckId: deck.id,
        consoleId: input.consoleId,
        name,
        color: CREW_COLORS[slot % CREW_COLORS.length]!,
        character: CREW_CHARACTERS[slot % CREW_CHARACTERS.length]!,
        provider,
        task: input.task,
        cwd,
        branch,
        missionSince: Date.now(),
      })
      .run();
    this.#broadcast(deck.id);

    try {
      await launcher.launch({
        crewId: id,
        missionId: id,
        provider,
        prompt: input.task,
        cwd,
        // A task for Claude starts in plan mode: it writes a brief for you to approve first.
        ...(provider === "claude-code" &&
          input.task.trim() && { plan: { instructions: BRIEF_INSTRUCTIONS } }),
        ...this.#lessonsFor(deck.id, provider),
      });
    } catch (error) {
      db.delete(crew).where(eq(crew.id, id)).run();
      this.#broadcast(deck.id);
      throw error;
    }
    return this.#info(this.#row(id)!);
  }

  /** Paste a prompt into the crew member's input box, then submit it. */
  async prompt(crewId: string, text: string, from: PromptFrom = "you"): Promise<void> {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    // Its Enter would answer the plan dialog (option 1 approves). The station's revise reason
    // is typed once the dialog has closed.
    if (from === "you" && this.#briefWaiting(crewId)) {
      throw new Error(`${row.name} has a brief waiting: Y to approve, N to revise`);
    }
    await this.#deps.launcher.write(crewId, bracketedPaste(text));
    // Its submit hook (working, no tool) is this prompt, not another one typed in the terminal.
    this.#submitting.add(crewId);
    setTimeout(() => void this.#deps.launcher.write(crewId, "\r"), SUBMIT_DELAY_MS);
    for (const listener of this.#promptListeners) listener({ crewId, from });
  }

  /**
   * Called after a prompt is typed into a crew member's input box: by the app or the station
   * (prompt), or by you in its terminal (seen as its submit hook).
   */
  onPrompt(listener: (e: { crewId: string; from: PromptFrom }) => void): () => void {
    this.#promptListeners.add(listener);
    return () => this.#promptListeners.delete(listener);
  }

  /** What its own worktree holds that sending it home could lose; null without one. */
  async worktree(crewId: string): Promise<WorktreeState | null> {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    const deck = this.#deck(row.deckId);
    if (!row.branch || row.cwd === deck.repoPath) return null;
    return worktreeState(deck.repoPath, row.cwd);
  }

  /**
   * Send a crew member home: its process stops, its console is free at once, and its own
   * worktree is kept, removed, or removed with its branch.
   */
  async sendHome(crewId: string, choice: WorktreeChoice): Promise<void> {
    const row = this.#row(crewId);
    if (!row) throw new Error(`No such crew member: ${crewId}`);
    const deck = this.#deck(row.deckId);
    this.#submitting.delete(crewId);
    this.#alerted.delete(crewId);
    this.#idleWaiting.delete(crewId);
    this.#endMission(row, {
      how: "home",
      endedAt: Date.now(),
      ...(row.prUrl && { prUrl: row.prUrl }),
      ...(row.branch && { branch: row.branch }),
    });
    this.#deps.db.delete(crew).where(eq(crew.id, crewId)).run();
    this.#broadcast(row.deckId);
    for (const listener of this.#goneListeners) listener(crewId);
    await this.#deps.launcher.stop(crewId);
    if (choice !== "keep" && row.branch && row.cwd !== deck.repoPath) {
      await removeWorktree({
        repoPath: deck.repoPath,
        path: row.cwd,
        branch: row.branch,
        deleteBranch: choice === "delete",
      });
    }
  }

  /** Called when a crew member leaves the deck. */
  onGone(listener: (crewId: string) => void): () => void {
    this.#goneListeners.add(listener);
    return () => this.#goneListeners.delete(listener);
  }

  handleSignal({
    crewId,
    signal,
    sessionId,
  }: {
    crewId: string;
    signal: CrewSignal;
    sessionId?: string;
  }): void {
    if (sessionId) {
      this.#deps.db.update(crew).set({ sessionId }).where(eq(crew.id, crewId)).run();
    }
    if (!this.#row(crewId)) return;
    if (signal.type === "working") this.#alerted.delete(crewId);
    else if (signal.type === "ended") this.#alerted.delete(crewId);
    // A station alert stands until the crew member works again.
    else if (this.#alerted.has(crewId)) return;
    // Claude only waiting at its prompt while a pre-flight decides what's next: not yet you.
    else if (signal.type === "needsInput" && signal.idle && this.#busy(crewId)) return;
    // Hooks post async: a later needs-you (Claude's permission notice) mustn't hide the brief.
    const brief = signal.type === "needsInput" && this.#briefWaiting(crewId);
    if (signal.type === "needsInput" && signal.idle && !brief) this.#idleWaiting.add(crewId);
    else this.#idleWaiting.delete(crewId);
    const action =
      signal.type === "working" && signal.activity
        ? (toolAction(signal.activity.tool, signal.activity.command) ?? null)
        : null;
    this.#update(crewId, STATUS_FOR_SIGNAL[signal.type], {
      action,
      detail:
        signal.type === "needsInput" && !brief
          ? signal.detail
          : signal.type === "plan" || brief
            ? "Brief ready"
            : null,
    });
    // Its submit hook: a prompt typed in the terminal is yours, unless prompt() typed it.
    if (signal.type === "working" && !signal.activity && !this.#submitting.delete(crewId)) {
      for (const listener of this.#promptListeners) listener({ crewId, from: "you" });
    }
  }

  handleExit(crewId: string): void {
    this.#alerted.delete(crewId);
    this.#idleWaiting.delete(crewId);
    this.#submitting.delete(crewId);
    this.#update(crewId, "asleep", { action: null, detail: null });
    for (const listener of this.#exitListeners) listener(crewId);
  }

  /** Called when a crew member's process has exited (or its session was found gone). */
  onExit(listener: (crewId: string) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** On startup: crew whose PTY session is gone or exited are asleep. */
  reconcile(sessions: { id: string; exited: boolean }[]): void {
    const alive = new Set(sessions.filter((s) => !s.exited).map((s) => s.id));
    for (const row of this.#deps.db.select().from(crew).all()) {
      if (!alive.has(row.id) && row.status !== "asleep") this.handleExit(row.id);
    }
  }

  #deck(id: string): typeof decks.$inferSelect {
    const deck = this.#deps.db.select().from(decks).where(eq(decks.id, id)).get();
    if (!deck) throw new Error(`No such deck: ${id}`);
    return deck;
  }

  #info(row: Row): CrewInfo {
    return toInfo(row, this.#describe);
  }

  #row(id: string): Row | undefined {
    return this.#deps.db.select().from(crew).where(eq(crew.id, id)).get();
  }

  #update(
    id: string,
    status: CrewStatus,
    patch: { action: Row["action"]; detail: string | null },
  ): void {
    const row = this.#row(id);
    if (!row) return;
    this.#deps.db
      .update(crew)
      .set({ status, ...patch, ...(status !== row.status && { statusSince: Date.now() }) })
      .where(eq(crew.id, id))
      .run();
    this.#broadcast(row.deckId);
  }

  #broadcast(deckId: string): void {
    this.#deps.broadcast({ type: "crew.roster", deckId, crew: this.roster(deckId) });
  }
}
