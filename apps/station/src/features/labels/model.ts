import { CONSOLE_COUNT } from "../crew/model";

/** The longest a sign's text may be, in characters. */
export const MAX_LABEL = 32;

/** What a sign can be painted (agent-office's SIGN_COLORS): its board, and its letters' ink. */
export const SIGN_COLORS = [
  { color: "#2b2d42", ink: "#fffaf3", name: "Navy" },
  { color: "#ef476f", ink: "#fffaf3", name: "Pink" },
  { color: "#f78c6b", ink: "#2b2d42", name: "Orange" },
  { color: "#ffd166", ink: "#2b2d42", name: "Yellow" },
  { color: "#06d6a0", ink: "#2b2d42", name: "Green" },
  { color: "#118ab2", ink: "#fffaf3", name: "Blue" },
  { color: "#9b5de5", ink: "#fffaf3", name: "Purple" },
] as const;

/** A few to start from, in the label window. */
export const LABEL_IDEAS = [
  "Operations",
  "Code cleanup",
  "Frontend",
  "Backend",
  "Bug fixes",
  "Docs",
  "Infra",
  "Research",
];

export const inkFor = (color: string) =>
  SIGN_COLORS.find((c) => c.color === color)?.ink ?? "#fffaf3";

export interface LabelInput {
  deckId: string;
  consoleId: number;
  /** Empty takes the sign down. */
  text: string;
  color: string;
}

export function parseLabelInput(input: unknown): LabelInput {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const deckId = typeof o.deckId === "string" ? o.deckId.trim() : "";
  if (!deckId) throw new Error("deckId is required");
  const consoleId = o.consoleId;
  if (
    !Number.isInteger(consoleId) ||
    (consoleId as number) < 0 ||
    (consoleId as number) >= CONSOLE_COUNT
  ) {
    throw new Error(`consoleId must be 0–${CONSOLE_COUNT - 1}`);
  }
  const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
  if (text.length > MAX_LABEL) throw new Error(`A sign fits ${MAX_LABEL} characters`);
  const color = SIGN_COLORS.some((c) => c.color === o.color)
    ? (o.color as string)
    : SIGN_COLORS[0].color;
  return { deckId, consoleId: consoleId as number, text, color };
}
