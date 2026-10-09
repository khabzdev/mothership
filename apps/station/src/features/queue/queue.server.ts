import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import { decks, queueTasks } from "../../shared/db/schema";
import type { CrewService } from "../crew/service.server";
import { CONSOLE_COUNT } from "../crew/model";

export type QueueTask = typeof queueTasks.$inferSelect;

export interface QueueDeps {
  db: Db;
  crew: Pick<CrewService, "roster" | "hire" | "sendHome">;
  /** Assign a queued issue on GitHub once crew start on it. */
  claim?: (deckId: string, issueNumber: number) => Promise<void>;
}

/** Statuses after which a crew member's queued task is finished. */
const FINISHED = new Set(["done", "asleep"]);

/**
 * agent-office's task queue: tasks wait in line, and whenever a console is free and fewer than the
 * deck's limit are running, the next one gets a fresh crew member in its own worktree. Finished
 * queue crew stay at their consoles until the queue needs the seat.
 */
export class QueueService {
  readonly #deps: QueueDeps;
  readonly #ticking = new Map<string, Promise<void>>();

  constructor(deps: QueueDeps) {
    this.#deps = deps;
  }

  list(deckId: string): QueueTask[] {
    return this.#deps.db
      .select()
      .from(queueTasks)
      .where(eq(queueTasks.deckId, deckId))
      .orderBy(asc(queueTasks.createdAt))
      .all();
  }

  limit(deckId: string): number {
    return this.#deps.db.select().from(decks).where(eq(decks.id, deckId)).get()?.queueLimit ?? 3;
  }

  async add(
    deckId: string,
    task: { title: string; prompt: string; issueNumber?: number },
  ): Promise<QueueTask> {
    const queued = this.list(deckId).find(
      (t) => task.issueNumber && t.issueNumber === task.issueNumber && t.state !== "done",
    );
    if (queued) throw new Error(`#${task.issueNumber} is already on the queue`);
    const row = this.#deps.db
      .insert(queueTasks)
      .values({
        id: crypto.randomUUID(),
        deckId,
        title: task.title,
        prompt: task.prompt,
        issueNumber: task.issueNumber ?? null,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    await this.tick(deckId);
    return row;
  }

  /** Take a task off the queue (one still waiting), or clear a finished one. */
  remove(id: string): void {
    this.#deps.db
      .delete(queueTasks)
      .where(and(eq(queueTasks.id, id), inArray(queueTasks.state, ["queued", "done"])))
      .run();
  }

  async setLimit(deckId: string, limit: number): Promise<void> {
    this.#deps.db.update(decks).set({ queueLimit: limit }).where(eq(decks.id, deckId)).run();
    await this.tick(deckId);
  }

  /** Bring the deck's queue up to date and seat crew for what's next; one tick at a time per deck. */
  tick(deckId: string): Promise<void> {
    const previous = this.#ticking.get(deckId) ?? Promise.resolve();
    const next = previous
      .then(() => this.#tick(deckId))
      .catch((error: unknown) => {
        console.error("[queue] tick failed", error);
      });
    this.#ticking.set(deckId, next);
    return next;
  }

  /** Tick every deck with something queued or running. */
  async tickAll(): Promise<void> {
    const deckIds = new Set(
      this.#deps.db
        .select({ deckId: queueTasks.deckId })
        .from(queueTasks)
        .where(inArray(queueTasks.state, ["queued", "running"]))
        .all()
        .map((r) => r.deckId),
    );
    await Promise.all([...deckIds].map((id) => this.tick(id)));
  }

  async #tick(deckId: string): Promise<void> {
    const { db, crew } = this.#deps;
    const set = (id: string, patch: Partial<QueueTask>) =>
      db.update(queueTasks).set(patch).where(eq(queueTasks.id, id)).run();

    // Running tasks whose crew finished (or went home) are done.
    for (const task of this.list(deckId).filter((t) => t.state === "running")) {
      const member = crew.roster(deckId).find((c) => c.id === task.crewId);
      if (!member || FINISHED.has(member.status)) set(task.id, { state: "done" });
    }

    const limit = this.limit(deckId);
    for (;;) {
      const tasks = this.list(deckId);
      const next = tasks.find((t) => t.state === "queued");
      if (!next || tasks.filter((t) => t.state === "running").length >= limit) return;
      const consoleId = await this.#freeConsole(deckId, tasks);
      if (consoleId === undefined) return;
      const member = await crew.hire({ deckId, consoleId, task: next.prompt, worktree: true });
      set(next.id, { state: "running", crewId: member.id, crewName: member.name });
      if (next.issueNumber && this.#deps.claim) {
        void this.#deps.claim(deckId, next.issueNumber).catch(() => {});
      }
    }
  }

  /** A free console; failing that, the seat of finished queue crew, sent home (worktree kept). */
  async #freeConsole(deckId: string, tasks: QueueTask[]): Promise<number | undefined> {
    const roster = this.#deps.crew.roster(deckId);
    const taken = new Set(roster.map((c) => c.consoleId));
    const free = Array.from({ length: CONSOLE_COUNT }, (_, i) => i).find((i) => !taken.has(i));
    if (free !== undefined) return free;
    const finished = roster.find(
      (c) => FINISHED.has(c.status) && tasks.some((t) => t.state === "done" && t.crewId === c.id),
    );
    if (!finished) return undefined;
    await this.#deps.crew.sendHome(finished.id, "keep");
    return finished.consoleId;
  }
}
