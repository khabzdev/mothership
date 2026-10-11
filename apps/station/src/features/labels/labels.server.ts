import type { ConsoleLabel, ServerMsg } from "@spaceship/protocol";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import { consoleLabels } from "../../shared/db/schema";
import type { LabelInput } from "./model";

/** Signs over a deck's consoles, kept across restarts and shown to everyone on the deck. */
export class LabelService {
  readonly #db: Db;
  readonly #broadcast: (msg: ServerMsg) => void;

  constructor(db: Db, broadcast: (msg: ServerMsg) => void) {
    this.#db = db;
    this.#broadcast = broadcast;
  }

  list(deckId: string): ConsoleLabel[] {
    return this.#db
      .select({
        consoleId: consoleLabels.consoleId,
        text: consoleLabels.text,
        color: consoleLabels.color,
      })
      .from(consoleLabels)
      .where(eq(consoleLabels.deckId, deckId))
      .orderBy(asc(consoleLabels.consoleId))
      .all();
  }

  /** Hang, repaint or (with no text) take down the sign over a console. */
  set({ deckId, consoleId, text, color }: LabelInput): ConsoleLabel[] {
    const where = and(eq(consoleLabels.deckId, deckId), eq(consoleLabels.consoleId, consoleId));
    if (!text) this.#db.delete(consoleLabels).where(where).run();
    else {
      this.#db
        .insert(consoleLabels)
        .values({ deckId, consoleId, text, color })
        .onConflictDoUpdate({
          target: [consoleLabels.deckId, consoleLabels.consoleId],
          set: { text, color },
        })
        .run();
    }
    const labels = this.list(deckId);
    this.#broadcast({ type: "deck.labels", deckId, labels });
    return labels;
  }
}
