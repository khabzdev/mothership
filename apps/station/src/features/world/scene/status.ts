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

export const STATUS_CHIPS: Record<CrewStatus, string> = {
  starting: "⏳ STARTING",
  idle: "💬 READY",
  working: "⌨️ WORKING",
  needs_input: "🙋 NEEDS YOU",
  done: "✅ DONE",
  asleep: "💤 ASLEEP",
};

/** A shell's chip: it's running or it has exited; it never works or waits by itself. */
export function chipFor(crew: Pick<CrewInfo, "kind" | "status">): string {
  if (crew.kind === "shell") return crew.status === "asleep" ? "💤 EXITED" : "🐚 SHELL";
  return STATUS_CHIPS[crew.status];
}
