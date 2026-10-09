import type { ServerMsg } from "@mothership/protocol";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { LabelService } from "../../src/features/labels/labels.server.ts";
import { parseLabelInput } from "../../src/features/labels/model.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

let db: Db;
let sent: ServerMsg[];
let labels: LabelService;

beforeEach(() => {
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: "/shop", modules: [] }).run();
  sent = [];
  labels = new LabelService(db, (msg) => sent.push(msg));
});

describe("console labels", () => {
  test("hang, repaint and take down a sign, telling everyone each time", () => {
    labels.set({ deckId: "deck-1", consoleId: 3, text: "Operations", color: "#118ab2" });
    labels.set({ deckId: "deck-1", consoleId: 3, text: "Ops", color: "#ef476f" });
    expect(labels.list("deck-1")).toEqual([{ consoleId: 3, text: "Ops", color: "#ef476f" }]);
    labels.set({ deckId: "deck-1", consoleId: 3, text: "", color: "#ef476f" });
    expect(labels.list("deck-1")).toEqual([]);
    expect(sent.map((m) => m.type === "deck.labels" && m.labels.length)).toEqual([1, 1, 0]);
  });

  test("input is tidied: one line, a known colour, and not too long", () => {
    expect(
      parseLabelInput({ deckId: "deck-1", consoleId: 0, text: "  Bug \n fixes ", color: "red" }),
    ).toEqual({ deckId: "deck-1", consoleId: 0, text: "Bug fixes", color: "#2b2d42" });
    expect(() => parseLabelInput({ deckId: "d", consoleId: 0, text: "x".repeat(33) })).toThrow(
      "32 characters",
    );
    expect(() => parseLabelInput({ deckId: "d", consoleId: 16, text: "x" })).toThrow("consoleId");
  });
});
