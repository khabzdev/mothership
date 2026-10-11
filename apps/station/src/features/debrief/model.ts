import type { MsgOf, ServerMsg } from "@spaceship/protocol";
import { PATCHES } from "../ranks/model";

export { parseDeckInput } from "../preflight/model";

export const LESSON_STATES = ["pending", "kept", "dropped", "retired"] as const;
export type LessonState = (typeof LESSON_STATES)[number];

/** The most lessons a deck keeps at once. */
export const MAX_KEPT_LESSONS = 12;

/** The longest a lesson may be, in characters. */
export const LESSON_MAX = 140;

/** Pending lessons older than this many days are hidden. */
export const PENDING_DAYS = 7;

/** The block given to new crew; "" when nothing is kept. */
export function lessonsPrompt(kept: string[]): string {
  if (kept.length === 0) return "";
  // The station owns control-character safety: whatever is stored, the launch gets clean lines.
  const lessons = kept.map(cleanLesson).filter(Boolean);
  if (lessons.length === 0) return "";
  return [
    "Lessons from earlier missions on this repo (follow them):",
    ...lessons.map((l) => `- ${l}`),
  ].join("\n");
}

// Lessons are model-written and end up in an argv element and a terminal: no control characters.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

/** `text` as one clean line, cut to LESSON_MAX code points (ellipsis included). */
export function cleanLesson(text: string): string {
  const line = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > LESSON_MAX ? `${chars.slice(0, LESSON_MAX - 1).join("")}…` : line;
}

export function parseLessonInput(input: unknown): { lessonId: string } {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const lessonId = typeof o.lessonId === "string" ? o.lessonId.trim() : "";
  if (!lessonId) throw new Error("lessonId is required");
  return { lessonId };
}

const lessonCount = (n: number) => `${n} ${n === 1 ? "lesson" : "lessons"}`;

/** Flight Control's screen line while lessons wait: "n lessons to review". */
export function lessonsToReview(n: number): string {
  return `${lessonCount(n)} to review`;
}

/** The toast for a finished debrief; null when it found nothing worth keeping. */
export function debriefToast(
  msg: MsgOf<ServerMsg, "deck.debrief">,
): { text: string; tone: "default" | "warning" } | null {
  if (msg.failed !== undefined) {
    return { text: `Debrief couldn't run for ${msg.name}: ${msg.failed}`, tone: "warning" };
  }
  if (msg.drafted === 0) return null;
  return {
    text: `Debrief: ${lessonCount(msg.drafted)} from ${msg.name} to review`,
    tone: "default",
  };
}

/** "<name> promoted to <Rank>" or "<name> earned <Patch name>"; null when it carries neither. */
export function promotionLine(msg: MsgOf<ServerMsg, "crew.promoted">): string | null {
  if (msg.rank) return `${msg.name} promoted to ${msg.rank}`;
  if (msg.patch) {
    const patch = PATCHES.find((p) => p.id === msg.patch)?.name ?? msg.patch;
    return `${msg.name} earned ${patch}`;
  }
  return null;
}
