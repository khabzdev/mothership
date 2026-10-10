import type { ServerMsg } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import { forDeck, pollLine } from "../../src/features/preflight/poll.ts";

const base = { done: false, allGo: false, deck: "Orion", crew: "Nova" };

describe("pollLine", () => {
  test("GO", () => {
    expect(pollLine({ ...base, check: "lint", verdict: "go" })).toBe("Lint… GO.");
  });
  test("NO-GO", () => {
    expect(pollLine({ ...base, check: "unit tests", verdict: "nogo" })).toBe("Unit tests… NO-GO.");
  });
  test("skipped says nothing", () => {
    expect(pollLine({ ...base, check: "lint", verdict: "skipped" })).toBeNull();
  });
  test("the last GO of an all-GO run calls the stations", () => {
    expect(pollLine({ ...base, check: "build", verdict: "go", done: true, allGo: true })).toBe(
      "Build… GO. Orion, Nova: all stations GO.",
    );
  });
  test("a done run with a NO-GO has no summary", () => {
    expect(pollLine({ ...base, check: "build", verdict: "nogo", done: true })).toBe(
      "Build… NO-GO.",
    );
  });
});

describe("forDeck", () => {
  const msg = (deckId: string): ServerMsg => ({
    type: "crew.preflight",
    deckId,
    crewId: "c1",
    preflightId: "p1",
    check: "lint",
    verdict: "go",
    done: false,
  });
  test("another deck's messages are ignored", () => {
    expect(forDeck(msg("d2"), "d1")).toBeNull();
    expect(forDeck({ type: "pr.merged" } as unknown as ServerMsg, "d1")).toBeNull();
  });
  test("this deck's pre-flight messages pass", () => {
    expect(forDeck(msg("d1"), "d1")?.check).toBe("lint");
  });
});
