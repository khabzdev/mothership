import type { BriefInfo, BriefState, ServerMsg } from "@mothership/protocol";
import { and, desc, eq, sql } from "drizzle-orm";
import { resolve, sep } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { briefs, crew as crewTable } from "../../shared/db/schema";
import type { CrewSignalEvent } from "../crew/hooks.server";
import type { ScreenSource } from "../crew/screens.server";
import type { CrewService } from "../crew/service.server";
import { dialogShown, findOption, screenLines, type Choice } from "./dialog";
import { goalOf } from "./model";

/**
 * After an option's key is typed, how long to wait before looking again: the dialog must be gone
 * before the brief settles, or the reason is typed (its Enter would answer the dialog).
 */
export const CONFIRM_DELAY_MS = 400;

/** Tools whose use, with a brief waiting, means you approved it in the terminal. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface BriefRecord {
  id: string;
  crewId: string;
  deckId: string;
  revision: number;
  text: string;
  state: BriefState;
  approvedBy?: "you" | "terminal";
  reason?: string;
  createdAt: number;
  settledAt?: number;
}

export type BriefAnswer = { ok: true } | { ok: false; message: string; openTerminal: boolean };

interface Deps {
  db: Db;
  crew: CrewService;
  screens: Pick<ScreenSource, "screen">;
  broadcast: (msg: ServerMsg) => void;
  /** Type into a crew member's terminal (the launcher's write). */
  write: (crewId: string, data: string) => Promise<void>;
}

type Row = typeof briefs.$inferSelect;

/**
 * Briefs: the plans Claude submits in plan mode, kept as revisions. Approving (Y) or revising
 * (N + a reason) answers Claude's plan-approval dialog by typing its option's key; an answer
 * given in the terminal settles the brief too. Whenever the dialog can't be found for sure,
 * nothing is typed.
 */
export class BriefService {
  readonly #db: Db;
  readonly #crew: CrewService;
  readonly #screens: Pick<ScreenSource, "screen">;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #write: (crewId: string, data: string) => Promise<void>;
  /** Each crew member's answer under way: the next one waits for it, so one brief gets one key. */
  readonly #answering = new Map<string, Promise<BriefAnswer>>();

  constructor(deps: Deps) {
    this.#db = deps.db;
    this.#crew = deps.crew;
    this.#screens = deps.screens;
    this.#broadcast = deps.broadcast;
    this.#write = deps.write;
    this.#crew.onGone((crewId) => this.#supersedeWaiting(crewId));
    // Its dialog went with its process: a resume must not inherit an answer it never got.
    this.#crew.onExit((crewId) => this.#supersedeWaiting(crewId));
  }

  /** A plan is a new waiting revision; an edit while one waits is its approval in the terminal. */
  handleSignal(e: CrewSignalEvent): void {
    const { crewId, signal } = e;
    if (signal.type === "plan") {
      this.#submit(crewId, signal.plan);
      return;
    }
    if (signal.type !== "working" || !signal.activity) return;
    const { tool, filePath } = signal.activity;
    if (!EDIT_TOOLS.has(tool) || !filePath || !this.#inWorkdir(crewId, filePath)) return;
    const latest = this.latest(crewId);
    if (latest?.state === "waiting") this.#approve(latest, "terminal");
  }

  /**
   * Whether a file is in the crew member's own working directory. Claude edits its plan file
   * (under ~/.claude) while still planning: only an edit to the work itself means you approved.
   */
  #inWorkdir(crewId: string, filePath: string): boolean {
    let cwd: string;
    try {
      cwd = resolve(this.#crew.workdir(crewId).cwd);
    } catch {
      return false;
    }
    const file = resolve(cwd, filePath);
    return file.startsWith(cwd.endsWith(sep) ? cwd : cwd + sep);
  }

  /** Y: choose the dialog's auto-accept option. */
  approve(crewId: string): Promise<BriefAnswer> {
    return this.#answer(crewId, "approve", "");
  }

  /** N: choose "keep planning", then type the reason for Claude to plan again with. */
  revise(crewId: string, reason: string): Promise<BriefAnswer> {
    return this.#answer(crewId, "revise", reason);
  }

  /** The roster's summary: the latest brief. */
  info(crewId: string): BriefInfo | undefined {
    const latest = this.latest(crewId);
    if (!latest) return undefined;
    return { revision: latest.revision, state: latest.state, goal: goalOf(latest.text) };
  }

  /** Whether the crew member's latest brief waits on its approval dialog. */
  waiting(crewId: string): boolean {
    return this.latest(crewId)?.state === "waiting";
  }

  /** Whether it has a brief and that brief isn't approved yet: it is still planning. */
  planning(crewId: string): boolean {
    const latest = this.latest(crewId);
    return !!latest && latest.state !== "approved";
  }

  /** Whether it has briefs and none of them is approved: a resume must plan again. */
  unapproved(crewId: string): boolean {
    const history = this.history(crewId);
    return history.length > 0 && !history.some((b) => b.state === "approved");
  }

  latest(crewId: string): BriefRecord | null {
    return this.history(crewId)[0] ?? null;
  }

  /** Every revision, newest first. */
  history(crewId: string): BriefRecord[] {
    return this.#db
      .select()
      .from(briefs)
      .where(eq(briefs.crewId, crewId))
      .orderBy(desc(briefs.revision))
      .all()
      .map(toRecord);
  }

  /** The latest approved revision, for the pull request's body. */
  approved(crewId: string): BriefRecord | null {
    return this.history(crewId).find((b) => b.state === "approved") ?? null;
  }

  /** On startup: a waiting brief whose dialog isn't on its crew member's screen is superseded. */
  async reconcile(): Promise<void> {
    const waiting = this.#db.select().from(briefs).where(eq(briefs.state, "waiting")).all();
    await Promise.all(
      waiting.map(async (row) => {
        if (dialogShown((await this.#lines(row.crewId)) ?? [])) return;
        // Answered or re-planned while we looked: leave it be.
        if (this.latest(row.crewId)?.id !== row.id) return;
        this.#settle(toRecord(row), { state: "superseded" });
      }),
    );
  }

  #submit(crewId: string, text: string): void {
    const member = this.#db.select().from(crewTable).where(eq(crewTable.id, crewId)).get();
    if (!member) return;
    const last = this.latest(crewId);
    this.#db.transaction((tx) => {
      if (last?.state === "waiting") {
        tx.update(briefs)
          .set({ state: "superseded", settledAt: Date.now() })
          .where(eq(briefs.id, last.id))
          .run();
      }
      tx.insert(briefs)
        .values({
          id: crypto.randomUUID(),
          deckId: member.deckId,
          crewId,
          revision: (last?.revision ?? 0) + 1,
          text,
          createdAt: Date.now(),
        })
        .run();
    });
    this.#changed(member.deckId, crewId);
  }

  /** One answer per crew member at a time: a second Y waits, then finds the brief settled. */
  #answer(crewId: string, choice: Choice, reason: string): Promise<BriefAnswer> {
    const before = this.#answering.get(crewId);
    // A failed answer (its key couldn't be typed) doesn't block the next one.
    const next = (before ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#press(crewId, choice, reason));
    this.#answering.set(crewId, next);
    next
      .catch(() => undefined)
      .finally(() => {
        if (this.#answering.get(crewId) === next) this.#answering.delete(crewId);
      });
    return next;
  }

  async #press(crewId: string, choice: Choice, reason: string): Promise<BriefAnswer> {
    const brief = this.latest(crewId);
    if (!brief) return { ok: false, message: "No brief to answer", openTerminal: false };
    if (brief.state !== "waiting") return already(brief.state);
    const name = this.#crewName(crewId);
    // Unreadable before the key: no dialog, so nothing is typed.
    const lines = (await this.#lines(crewId)) ?? [];
    // The terminal (or a new plan) may have settled it while the screen was read.
    const now = this.latest(crewId);
    if (now?.id !== brief.id || now.state !== "waiting")
      return already(brief.id === now?.id ? now.state : "superseded");
    const missing: BriefAnswer = {
      ok: false,
      message: `Couldn't find ${name}'s approval dialog: opened its terminal`,
      openTerminal: true,
    };
    const key = findOption(lines, choice);
    if (key === null) {
      if (!dialogShown(lines)) this.#settle(brief, { state: "superseded" });
      return missing;
    }
    try {
      await this.#write(crewId, key);
    } catch (error) {
      console.warn(`[briefs] couldn't type into ${crewId}'s terminal: ${(error as Error).message}`);
      return missing;
    }
    await new Promise((done) => setTimeout(done, CONFIRM_DELAY_MS));
    const after = await this.#lines(crewId);
    // Settled in the terminal, or a new plan came while we waited: nothing more to type.
    const latest = this.latest(crewId);
    if (latest?.id !== brief.id) return already("superseded");
    if (latest.state !== "waiting") return already(latest.state);
    // The key didn't take (or the screen can't be read to tell): an Enter now could answer the
    // dialog, so the brief still waits.
    if (after === null || dialogShown(after)) return missing;
    if (choice === "approve") {
      this.#approve(brief, "you");
      return { ok: true };
    }
    this.#settle(brief, { state: "revised", reason });
    try {
      await this.#crew.prompt(crewId, reason, "station");
    } catch (error) {
      console.warn(`[briefs] couldn't type ${crewId}'s reason: ${(error as Error).message}`);
      return {
        ok: false,
        message: `Couldn't type the reason into ${name}'s terminal: opened it`,
        openTerminal: true,
      };
    }
    return { ok: true };
  }

  /** Approve a waiting brief; false when it was no longer waiting. */
  #approve(brief: BriefRecord, by: "you" | "terminal"): boolean {
    const changed = this.#db.transaction((tx) => {
      const { changes } = tx
        .update(briefs)
        .set({ state: "approved", approvedBy: by, settledAt: Date.now() })
        .where(and(eq(briefs.id, brief.id), eq(briefs.state, "waiting")))
        .run();
      // A clean brief: approved as first written, with no revision asked for.
      if (changes > 0 && brief.revision === 1) {
        tx.update(crewTable)
          .set({ cleanBriefs: sql`${crewTable.cleanBriefs} + 1` })
          .where(eq(crewTable.id, brief.crewId))
          .run();
      }
      return changes > 0;
    });
    if (changed) this.#changed(brief.deckId, brief.crewId);
    return changed;
  }

  /** Settle a waiting brief; false when it was no longer waiting. */
  #settle(
    brief: BriefRecord,
    patch: { state: "superseded" } | { state: "revised"; reason: string },
  ): boolean {
    const { changes } = this.#db
      .update(briefs)
      .set({ ...patch, settledAt: Date.now() })
      .where(and(eq(briefs.id, brief.id), eq(briefs.state, "waiting")))
      .run();
    if (changes > 0) this.#changed(brief.deckId, brief.crewId);
    return changes > 0;
  }

  #supersedeWaiting(crewId: string): void {
    const latest = this.latest(crewId);
    if (latest?.state === "waiting") this.#settle(latest, { state: "superseded" });
  }

  /** The crew member's screen as text lines, or null when it can't be read. */
  async #lines(crewId: string): Promise<string[] | null> {
    try {
      return screenLines(await this.#screens.screen(crewId));
    } catch (error) {
      console.warn(`[briefs] can't read ${crewId}'s screen: ${(error as Error).message}`);
      return null;
    }
  }

  #crewName(crewId: string): string {
    return (
      this.#db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()?.name ?? "the crew"
    );
  }

  #changed(deckId: string, crewId: string): void {
    this.#crew.refresh(deckId);
    this.#broadcast({ type: "crew.brief", deckId, crewId });
  }
}

function already(state: BriefState): BriefAnswer {
  return { ok: false, message: `Already ${state}`, openTerminal: false };
}

function toRecord(row: Row): BriefRecord {
  return {
    id: row.id,
    crewId: row.crewId,
    deckId: row.deckId,
    revision: row.revision,
    text: row.text,
    state: row.state,
    ...(row.approvedBy && { approvedBy: row.approvedBy }),
    ...(row.reason !== null && { reason: row.reason }),
    createdAt: row.createdAt,
    ...(row.settledAt !== null && { settledAt: row.settledAt }),
  };
}
