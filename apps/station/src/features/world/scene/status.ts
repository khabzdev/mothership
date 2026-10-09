import type { CrewInfo, CrewStatus } from "@mothership/protocol";

/** Helmet-light colours: agent-office's antenna bulb colours. */
export const STATUS_COLORS: Record<CrewStatus, string> = {
  starting: "#adb5bd",
  idle: "#8ecae6",
  working: "#ffd166",
  needs_input: "#ef476f",
  done: "#06d6a0",
  asleep: "#6c757d",
};

export type StatusTone = "error" | "warning" | "success" | "neutral";

const TONES: Record<CrewStatus, StatusTone> = {
  starting: "neutral",
  idle: "neutral",
  working: "warning",
  needs_input: "error",
  done: "success",
  asleep: "neutral",
};

const LABELS: Record<CrewStatus, string> = {
  starting: "Starting",
  idle: "Ready",
  working: "Working",
  needs_input: "Needs you",
  done: "Done",
  asleep: "Asleep",
};

/** A crew member's status in words and a tone (a shell is running or has exited). */
export function statusOf(crew: Pick<CrewInfo, "kind" | "status">): {
  label: string;
  tone: StatusTone;
} {
  if (crew.kind === "shell") {
    return { label: crew.status === "asleep" ? "Exited" : "Shell", tone: "neutral" };
  }
  return { label: LABELS[crew.status], tone: TONES[crew.status] };
}
