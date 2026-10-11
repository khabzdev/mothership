import { Badge } from "@cloudflare/kumo";
import type { CrewInfo } from "@spaceship/protocol";
import { statusOf } from "../scene/status";

/** A crew member's status as a Kumo dot badge. */
export function StatusBadge({ crew }: { crew: Pick<CrewInfo, "kind" | "status"> }) {
  const { label, tone } = statusOf(crew);
  return (
    <Badge variant={tone} appearance="dot">
      {label}
    </Badge>
  );
}
