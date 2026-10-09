/** Consoles per deck (agent-office has 16 desks per floor). */
export const CONSOLE_COUNT = 16;

/** Crew call signs, handed out in order per deck. */
export const CREW_NAMES = [
  "Nova",
  "Comet",
  "Orbit",
  "Quasar",
  "Pulsar",
  "Vega",
  "Ion",
  "Photon",
  "Zenith",
  "Halo",
  "Kepler",
  "Lyra",
  "Titan",
  "Juno",
  "Atlas",
  "Rigel",
  "Sol",
  "Astra",
  "Cosmo",
  "Luna",
] as const;

export const CREW_COLORS = [
  "#ff5f1f",
  "#5bc0eb",
  "#9bc53d",
  "#fde74c",
  "#c3423f",
  "#b388eb",
  "#f7aef8",
  "#72ddf7",
  "#ffb400",
  "#00a6a6",
] as const;

/** KayKit characters crew can be (the Knight is the Captain). */
export const CREW_CHARACTERS = ["Barbarian", "Mage", "Rogue", "Rogue_Hooded"] as const;

export interface HireInput {
  deckId: string;
  consoleId: number;
  task: string;
  /** Work in its own git worktree & branch (agent-office's checkbox). */
  worktree: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function parseHireInput(input: unknown): HireInput {
  if (!isObject(input)) throw new Error("Expected { deckId, consoleId, task }");
  const deckId = typeof input.deckId === "string" ? input.deckId.trim() : "";
  if (!deckId) throw new Error("deckId is required");
  const consoleId = input.consoleId;
  if (
    !Number.isInteger(consoleId) ||
    (consoleId as number) < 0 ||
    (consoleId as number) >= CONSOLE_COUNT
  ) {
    throw new Error(`consoleId must be 0–${CONSOLE_COUNT - 1}`);
  }
  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (task.length > 20_000) throw new Error("Task is too long");
  return { deckId, consoleId: consoleId as number, task, worktree: input.worktree === true };
}

export function parsePromptInput(input: unknown): { crewId: string; text: string } {
  if (!isObject(input)) throw new Error("Expected { crewId, text }");
  const crewId = typeof input.crewId === "string" ? input.crewId.trim() : "";
  const text = typeof input.text === "string" ? input.text.replace(/\r\n?/g, "\n").trim() : "";
  if (!crewId) throw new Error("crewId is required");
  if (!text) throw new Error("Empty prompt");
  return { crewId, text };
}

export function parseCrewIdInput(input: unknown): { crewId: string } {
  const crewId = isObject(input) && typeof input.crewId === "string" ? input.crewId.trim() : "";
  if (!crewId) throw new Error("crewId is required");
  return { crewId };
}

export const WORKTREE_CHOICES = ["keep", "remove", "delete"] as const;
/** What to do with a crew member's own worktree when it goes home. */
export type WorktreeChoice = (typeof WORKTREE_CHOICES)[number];

export interface SendHomeInput {
  crewId: string;
  worktree: WorktreeChoice;
}

export function parseSendHomeInput(input: unknown): SendHomeInput {
  const { crewId } = parseCrewIdInput(input);
  const worktree = (isObject(input) && input.worktree) || "keep";
  if (!WORKTREE_CHOICES.includes(worktree as WorktreeChoice)) {
    throw new Error("worktree must be keep, remove or delete");
  }
  return { crewId, worktree: worktree as WorktreeChoice };
}
