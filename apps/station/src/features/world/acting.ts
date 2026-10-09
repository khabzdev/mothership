import type { CrewAction, CrewInfo } from "@mothership/protocol";

// What a seated crew member acts out (agent-office's worker-stance acts): typing while it works,
// or its latest tool call: reading papers, typing flat out, leaning back on a test run, watching
// the web globe, head in its hands when something failed.

export type Act = "rest" | "type" | CrewAction;

/** How long an act is kept before the next one (s), so quick tool calls don't flicker. */
export const ACT_MIN = 1.2;
/** Head in its hands lasts at least this long, so you catch it. */
export const DESPAIR_MIN = 4;

/** The act a crew member's status and action call for right now. */
export function actFor(crew: Pick<CrewInfo, "status" | "action">): Act {
  if (crew.status !== "working") return "rest";
  return crew.action ?? "type";
}

/** Holds each act for its minimum time before moving on to the latest one asked for. */
export class ActHold {
  #act: Act = "rest";
  #since = Number.NEGATIVE_INFINITY;

  /** The act to show at time `t` (s) when `wanted` is asked for. */
  at(wanted: Act, t: number): Act {
    if (wanted === this.#act) return this.#act;
    const min = this.#act === "failing" ? DESPAIR_MIN : ACT_MIN;
    // Rest (stopped working) comes at once; only tool-call acts are held.
    if (wanted === "rest" || this.#act === "rest" || t - this.#since >= min) {
      this.#act = wanted;
      this.#since = t;
    }
    return this.#act;
  }
}
