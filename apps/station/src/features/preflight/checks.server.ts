import type { DeckCheck, ServerMsg } from "@mothership/protocol";
import { and, asc, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { deckChecks, decks } from "../../shared/db/schema";
import { detectChecks, SNAPSHOT_FILES, type RepoSnapshot } from "./detect";
import { DEFAULT_TIMEOUT_MS, type CheckPatch } from "./model";

/** Read the few files detection looks at; a missing file is undefined. */
export async function readSnapshot(repoPath: string): Promise<RepoSnapshot> {
  const snap: RepoSnapshot = {};
  await Promise.all(
    SNAPSHOT_FILES.map(async (file) => {
      snap[file] = await readFile(join(repoPath, file), "utf8").then(
        (text) => text,
        () => undefined,
      );
    }),
  );
  return snap;
}

interface Deps {
  db: Db;
  broadcast: (msg: ServerMsg) => void;
}

/** A deck's pre-flight checks: detected from its repo, editable, and armed by the user. */
export class CheckService {
  readonly #db: Db;
  readonly #broadcast: (msg: ServerMsg) => void;

  constructor({ db, broadcast }: Deps) {
    this.#db = db;
    this.#broadcast = broadcast;
  }

  list(deckId: string): DeckCheck[] {
    return this.#db
      .select({
        id: deckChecks.id,
        name: deckChecks.name,
        command: deckChecks.command,
        timeoutMs: deckChecks.timeoutMs,
        enabled: deckChecks.enabled,
      })
      .from(deckChecks)
      .where(eq(deckChecks.deckId, deckId))
      .orderBy(asc(deckChecks.position))
      .all();
  }

  /** null until the user has been asked. */
  armed(deckId: string): boolean | null {
    return (
      this.#db.select({ armed: decks.checksArmed }).from(decks).where(eq(decks.id, deckId)).get()
        ?.armed ?? null
    );
  }

  enabled(deckId: string): DeckCheck[] {
    return this.list(deckId).filter((c) => c.enabled);
  }

  /** Look at the repo again and replace the list; arming is kept. */
  async detect(deckId: string): Promise<DeckCheck[]> {
    const deck = this.#db.select().from(decks).where(eq(decks.id, deckId)).get();
    if (!deck) throw new Error("No such deck");
    const found = detectChecks(await readSnapshot(deck.repoPath));
    this.#db.transaction((tx) => {
      tx.delete(deckChecks).where(eq(deckChecks.deckId, deckId)).run();
      found.forEach((c, position) =>
        tx
          .insert(deckChecks)
          .values({
            id: crypto.randomUUID(),
            deckId,
            name: c.name,
            command: c.command,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            position,
          })
          .run(),
      );
    });
    this.#broadcast(this.message(deckId));
    return this.list(deckId);
  }

  /** Detect once: only for a deck nobody has been asked about yet. */
  async ensureDetected(deckId: string): Promise<DeckCheck[]> {
    const have = this.list(deckId);
    if (have.length > 0 || this.armed(deckId) !== null) return have;
    return this.detect(deckId);
  }

  arm(deckId: string, armed: boolean): void {
    this.#db.update(decks).set({ checksArmed: armed }).where(eq(decks.id, deckId)).run();
    this.#broadcast(this.message(deckId));
  }

  update({ deckId, checkId, command, enabled, timeoutMs }: CheckPatch): DeckCheck {
    const set = {
      ...(command !== undefined && { command }),
      ...(enabled !== undefined && { enabled }),
      ...(timeoutMs !== undefined && { timeoutMs }),
    };
    const where = and(eq(deckChecks.id, checkId), eq(deckChecks.deckId, deckId));
    if (Object.keys(set).length > 0) this.#db.update(deckChecks).set(set).where(where).run();
    const check = this.list(deckId).find((c) => c.id === checkId);
    if (!check) throw new Error("No such check");
    this.#broadcast(this.message(deckId));
    return check;
  }

  message(deckId: string): ServerMsg {
    const deck = this.#db.select().from(decks).where(eq(decks.id, deckId)).get();
    return {
      type: "deck.checks",
      deckId,
      armed: this.armed(deckId),
      checks: this.list(deckId),
      inspector: deck?.inspector ?? true,
    };
  }
}
