import type { CheckVerdict } from "@mothership/protocol";

/** Hand-backs a crew member gets per flight, so at most this many plus one attempts. */
export const DEFAULT_FUEL = 3;

/** What follows a finished pre-flight. */
export type Outcome =
  | { kind: "go" }
  | { kind: "handBack"; attempt: number; maxAttempts: number }
  | { kind: "outOfFuel"; attempts: number };

/**
 * Decide what follows attempt `attempt` of a flight with `fuel` hand-backs left: GO when every
 * check (and at least one) went, otherwise hand the failures back while there's fuel.
 */
export function afterPreflight(verdicts: CheckVerdict[], fuel: number, attempt: number): Outcome {
  if (verdicts.length > 0 && verdicts.every((v) => v === "go")) return { kind: "go" };
  if (fuel > 0) return { kind: "handBack", attempt: attempt + 1, maxAttempts: fuel + attempt };
  return { kind: "outOfFuel", attempts: attempt };
}
