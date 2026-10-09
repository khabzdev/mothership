import type { CrewInfo, CrewStatus, ServerMsg } from "@mothership/protocol";
import type { CrewSignal } from "@mothership/providers";
import { and, asc, eq } from "drizzle-orm";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { crew, decks } from "../../shared/db/schema";
import { toolAction } from "./actions";
import type { CrewLauncher } from "./launcher.server";
import { CREW_CHARACTERS, CREW_COLORS, CREW_NAMES, type HireInput } from "./model";
import { branchName, createWorktree } from "./worktree.server";

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
  stopped: "done",
  ended: "asleep",
};

/** Delay between pasting a prompt and pressing Enter (as agent-office does). */
const SUBMIT_DELAY_MS = 120;

function toInfo(row: Row): CrewInfo {
  return {
    id: row.id,
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
  };
}

/** Crew at consoles: hiring, prompting, and keeping their status in step with their hooks. */
export class CrewService {
  readonly #deps: CrewServiceDeps;

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
      .map(toInfo);
  }

  async hire(input: HireInput): Promise<CrewInfo> {
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
        task: input.task,
        cwd,
        branch,
      })
      .run();
    this.#broadcast(deck.id);

    try {
      await launcher.launch({
        crewId: id,
        missionId: id,
        provider: "claude-code",
        prompt: input.task,
        cwd,
      });
    } catch (error) {
      db.delete(crew).where(eq(crew.id, id)).run();
      this.#broadcast(deck.id);
      throw error;
    }
    return toInfo(this.#row(id)!);
  }

  /** Paste a prompt into the crew member's input box, then submit it. */
  async prompt(crewId: string, text: string): Promise<void> {
    if (!this.#row(crewId)) throw new Error(`No such crew member: ${crewId}`);
    await this.#deps.launcher.write(crewId, `\x1b[200~${text}\x1b[201~`);
    setTimeout(() => void this.#deps.launcher.write(crewId, "\r"), SUBMIT_DELAY_MS);
  }

  handleSignal({ crewId, signal }: { crewId: string; signal: CrewSignal }): void {
    const action =
      signal.type === "working" && signal.activity
        ? (toolAction(signal.activity.tool, signal.activity.command) ?? null)
        : null;
    this.#update(crewId, STATUS_FOR_SIGNAL[signal.type], {
      action,
      detail: signal.type === "needsInput" ? signal.detail : null,
    });
  }

  handleExit(crewId: string): void {
    this.#update(crewId, "asleep", { action: null, detail: null });
  }

  /** On startup: crew whose PTY session is gone or exited are asleep. */
  reconcile(sessions: { id: string; exited: boolean }[]): void {
    const alive = new Set(sessions.filter((s) => !s.exited).map((s) => s.id));
    for (const row of this.#deps.db.select().from(crew).all()) {
      if (!alive.has(row.id) && row.status !== "asleep") this.handleExit(row.id);
    }
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
