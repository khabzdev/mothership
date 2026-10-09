// The Changes window's data (agent-office's shared/protocol/changes.ts).

export type ChangeStatus = "M" | "A" | "D" | "R" | "T" | "?";

export interface ChangedFile {
  path: string;
  /** The old path, when the file was renamed. */
  from?: string;
  /** M modified, A added, D deleted, R renamed, T type changed, ? new (never committed). */
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Not committed yet: staged, unstaged or untracked. */
  uncommitted: boolean;
}

export interface ChangesState {
  /** The checkout's branch ('HEAD' when detached). */
  branch: string;
  /** What the changes are against: the deck's checkout it branched from, or 'HEAD'. */
  base: string;
  /** Commits on the branch since it left the deck's checkout. */
  ahead: number;
  /** The newest commit's subject, when ahead > 0. */
  subject?: string;
  files: ChangedFile[];
  /** Files left out of a very long list. */
  more: number;
}

export const STATUS_WORD: Record<ChangeStatus, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  T: "type changed",
  "?": "new file",
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function crewIdOf(input: unknown): string {
  const crewId = isObject(input) && typeof input.crewId === "string" ? input.crewId.trim() : "";
  if (!crewId) throw new Error("crewId is required");
  return crewId;
}

export function parseFileInput(input: unknown): { crewId: string; path: string } {
  const path = isObject(input) && typeof input.path === "string" ? input.path : "";
  if (!path) throw new Error("path is required");
  return { crewId: crewIdOf(input), path };
}

export function parseCommitInput(input: unknown): { crewId: string; message: string } {
  const message = isObject(input) && typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("A commit needs a message");
  return { crewId: crewIdOf(input), message };
}

export function parseDiscardInput(input: unknown): { crewId: string; path?: string } {
  const path = isObject(input) && typeof input.path === "string" ? input.path : undefined;
  return { crewId: crewIdOf(input), ...(path && { path }) };
}
