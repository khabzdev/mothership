import type { decks } from "../../shared/db/schema";

export type Deck = typeof decks.$inferSelect;

export interface DockRepoInput {
  repoPath: string;
}

export function parseDockRepoInput(input: unknown): DockRepoInput {
  if (typeof input !== "object" || input === null) throw new Error("Expected { repoPath }");
  const { repoPath } = input as Record<string, unknown>;
  if (typeof repoPath !== "string") throw new Error("repoPath must be a string");
  if (repoPath.includes("\0")) throw new Error("repoPath must not contain NUL");
  const trimmed = repoPath.trim();
  if (!trimmed.startsWith("/")) throw new Error("repoPath must be an absolute path");
  return { repoPath: trimmed };
}

export function parseDeckIdInput(input: unknown): { deckId: string } {
  const deckId =
    typeof input === "object" &&
    input !== null &&
    typeof (input as { deckId?: unknown }).deckId === "string"
      ? (input as { deckId: string }).deckId.trim()
      : "";
  if (!deckId) throw new Error("deckId is required");
  return { deckId };
}
