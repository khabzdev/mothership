import type { BriefInfo, BriefState, ServerMsg } from "@mothership/protocol";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import { briefs, crew as crewTable } from "../../shared/db/schema";
import type { CrewSignalEvent } from "../crew/hooks.server";
import type { ScreenSource } from "../crew/screens.server";
import type { CrewService } from "../crew/service.server";
import { dialogShown, findOption, screenLines, type Choice } from "./dialog";
import { goalOf } from "./model";

/** After "keep planning" is pressed, how long to wait before typing the reason (ms). */
export const REASON_DELAY_MS = 400;

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
  }

  /** A plan is a new waiting revision; an edit while one waits is its approval in the terminal. */
  handleSignal(e: CrewSignalEvent): void {
    const { crewId, signal } = e;
    if (signal.type === "plan") {
      this.#submit(crewId, signal.plan);
      return;
    }
    if (signal.type !== "working" || !signal.activity) return;
    if (!EDIT_TOOLS.has(signal.activity.tool)) return;
    const latest = this.latest(crewId);
    if (latest?.state === "waiting") this.#approve(latest, "terminal");
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
        if (dialogShown(await this.#lines(row.crewId))) return;
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
    const lines = await this.#lines(crewId);
    // The terminal (or a new plan) may have settled it while the screen was read.
    const now = this.latest(crewId);
    if (now?.id !== brief.id || now.state !== "waiting")
      return already(brief.id === now?.id ? now.state : "superseded");
    const key = findOption(lines, choice);
    if (key === null) {
      if (!dialogShown(lines)) this.#settle(brief, { state: "superseded" });
      return {
        ok: false,
        message: `Couldn't find ${name}'s approval dialog: opened its terminal`,
        openTerminal: true,
      };
    }
    await this.#write(crewId, key);
    if (choice === "approve") {
      this.#approve(brief, "you");
      return { ok: true };
    }
    this.#settle(brief, { state: "revised", reason });
    await new Promise((resolve) => setTimeout(resolve, REASON_DELAY_MS));
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

  #approve(brief: BriefRecord, by: "you" | "terminal"): void {
    this.#db.transaction((tx) => {
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
    });
    this.#changed(brief.deckId, brief.crewId);
  }

  #settle(
    brief: BriefRecord,
    patch: { state: "superseded" } | { state: "revised"; reason: string },
  ): void {
    this.#db
      .update(briefs)
      .set({ ...patch, settledAt: Date.now() })
      .where(and(eq(briefs.id, brief.id), eq(briefs.state, "waiting")))
      .run();
    this.#changed(brief.deckId, brief.crewId);
  }

  #supersedeWaiting(crewId: string): void {
    const latest = this.latest(crewId);
    if (latest?.state === "waiting") this.#settle(latest, { state: "superseded" });
  }

  /** The crew member's screen as text lines; one that can't be read shows no dialog. */
  async #lines(crewId: string): Promise<string[]> {
    try {
      return screenLines(await this.#screens.screen(crewId));
    } catch (error) {
      console.warn(`[briefs] can't read ${crewId}'s screen: ${(error as Error).message}`);
      return [];
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
