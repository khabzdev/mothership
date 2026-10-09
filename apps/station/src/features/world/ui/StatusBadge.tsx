import { Badge } from "@cloudflare/kumo";
import type { CrewInfo } from "@mothership/protocol";

type Variant = "error" | "warning" | "success" | "info" | "neutral";

const VARIANTS: Record<CrewInfo["status"], Variant> = {
  starting: "neutral",
  idle: "info",
  working: "warning",
  needs_input: "error",
  done: "success",
  asleep: "neutral",
};

const LABELS: Record<CrewInfo["status"], string> = {
  starting: "Starting",
  idle: "Ready",
  working: "Working",
  needs_input: "Needs you",
  done: "Done",
  asleep: "Asleep",
};

/** A crew member's status as a Kumo dot badge (a shell is running or has exited). */
export function StatusBadge({ crew }: { crew: Pick<CrewInfo, "kind" | "status"> }) {
  if (crew.kind === "shell") {
    const exited = crew.status === "asleep";
    return (
      <Badge variant={exited ? "neutral" : "info"} appearance="dot">
        {exited ? "Exited" : "Shell"}
      </Badge>
    );
  }
  return (
    <Badge variant={VARIANTS[crew.status]} appearance="dot">
      {LABELS[crew.status]}
    </Badge>
  );
}
