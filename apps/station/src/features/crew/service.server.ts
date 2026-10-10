import type { CrewInfo, CrewStatus, PreflightInfo, ServerMsg } from "@mothership/protocol";
import type { CrewSignal } from "@mothership/providers";
import { and, asc, eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
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
  /** Mothership home; worktrees live under `<home>/worktrees`. */
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

/** Delay between pasting a prompt and pressing Enter (as agent-office does). */
const SUBMIT_DELAY_MS = 120;

/** Who typed a prompt: you, or the station handing pre-flight failures back. */
export type PromptFrom = "you" | "station";

type Describe = (crewId: string) => PreflightInfo | undefined;
type Busy = (crewId: string) => boolean;

function toInfo(row: Row, describe?: Describe): CrewInfo {
  const preflight = describe?.(row.id);
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
  };
}

/** Crew at consoles: hiring, prompting, and keeping their status in step with their hooks. */
export class CrewService {
  readonly #deps: CrewServiceDeps;
  readonly #goneListeners = new Set<(crewId: string) => void>();
  readonly #promptListeners = new Set<(e: { crewId: string; from: PromptFrom }) => void>();
  #describe: Describe | undefined;
  #busy: Busy = () => false;
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

  /** Add each crew member's pre-flight summary to what the roster says about it. */
  describeWith(fn: Describe): void {
    this.#describe = fn;
  }

  /** Ask whether a pre-flight is busy with a crew member, so Claude's idle nudge doesn't count. */
  busyWith(fn: Busy): void {
    this.#busy = fn;
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
    this.#update(crewId, shell ? "idle" : "starting", { action: null, detail: null });
    try {
      await this.#deps.launcher.launch({
        crewId,
        missionId: crewId,
        provider: row.provider,
        prompt: "",
        cwd: row.cwd,
        ...(row.sessionId && !shell && { resume: row.sessionId }),
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
      })
      .run();
    this.#broadcast(deck.id);

    try {
      await launcher.launch({ crewId: id, missionId: id, provider, prompt: input.task, cwd });
    } catch (error) {
      db.delete(crew).where(eq(crew.id, id)).run();
      this.#broadcast(deck.id);
      throw error;
    }
    return this.#info(this.#row(id)!);
  }

  /** Paste a prompt into the crew member's input box, then submit it. */
  async prompt(crewId: string, text: string, from: PromptFrom = "you"): Promise<void> {
    if (!this.#row(crewId)) throw new Error(`No such crew member: ${crewId}`);
    await this.#deps.launcher.write(crewId, `\x1b[200~${text}\x1b[201~`);
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
    if (signal.type === "needsInput" && signal.idle) this.#idleWaiting.add(crewId);
    else this.#idleWaiting.delete(crewId);
    const action =
      signal.type === "working" && signal.activity
        ? (toolAction(signal.activity.tool, signal.activity.command) ?? null)
        : null;
    this.#update(crewId, STATUS_FOR_SIGNAL[signal.type], {
      action,
      detail:
        signal.type === "needsInput"
          ? signal.detail
          : signal.type === "plan"
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
