import type { CheckVerdict } from "@spaceship/protocol";

/** Hand-backs a crew member gets per flight, so at most this many plus one attempts. */
export const DEFAULT_FUEL = 3;

/** What follows a finished pre-flight or inspection. */
export type Outcome =
  | { kind: "go" }
  | { kind: "handBack"; attempt: number; maxAttempts: number }
  | { kind: "outOfFuel"; attempts: number };

/**
 * Decide what follows attempt `attempt` of a flight with `fuel` hand-backs left: GO when every
 * check (and at least one) went, otherwise hand the failures back while there's fuel.
 */
export function afterPreflight(verdicts: CheckVerdict[], fuel: number, attempt: number): Outcome {
  return afterVerdict(verdicts.length > 0 && verdicts.every((v) => v === "go"), fuel, attempt);
}

/**
 * The fuel rule pre-flight and the Inspector share: a verdict that isn't ok after attempt
 * `attempt` is handed back while there's fuel (attempt n+1 of fuel+attempt), then needs you.
 */
export function afterVerdict(ok: boolean, fuel: number, attempt: number): Outcome {
  if (ok) return { kind: "go" };
  if (fuel > 0) return { kind: "handBack", attempt: attempt + 1, maxAttempts: fuel + attempt };
  return { kind: "outOfFuel", attempts: attempt };
}
