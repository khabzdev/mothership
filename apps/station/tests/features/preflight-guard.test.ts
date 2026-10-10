import { describe, expect, test } from "vite-plus/test";
import { launchGuard } from "../../src/features/preflight/guard.ts";
import { prEvidence } from "../../src/features/preflight/report.ts";
import type { PreflightRecord } from "../../src/features/preflight/preflight.server.ts";

const record = (over: Partial<PreflightRecord> = {}): PreflightRecord => ({
  id: "p1",
  crewId: "c1",
  deckId: "d1",
  flight: 1,
  attempt: 2,
  state: "go",
  trigger: "stop",
  commit: "abc1234def5678",
  fingerprint: "same",
  startedAt: 1_000,
  finishedAt: 42_000,
  results: [
    {
      checkId: "k1",
      name: "check",
      command: "vp check",
      verdict: "go",
      exitCode: 0,
      timedOut: false,
      durationMs: 6100,
      tail: "",
    },
  ],
  ...over,
});

const NO_GO = "No GO on record for this commit. Launch anyway?";

describe("launchGuard", () => {
  test("no record", () => expect(launchGuard(null, { hash: "same" }, true)).toBe(NO_GO));
  test("a stale hash", () => expect(launchGuard(record(), { hash: "other" }, true)).toBe(NO_GO));
  test("a NO-GO run", () =>
    expect(launchGuard(record({ state: "nogo" }), { hash: "same" }, true)).toBe(NO_GO));
  test("a GO with the same hash", () =>
    expect(launchGuard(record(), { hash: "same" }, true)).toBeNull());
  test("unarmed", () => expect(launchGuard(null, { hash: "same" }, false)).toBeNull());
});

describe("prEvidence", () => {
  test("a GO table", () => {
    expect(prEvidence(record())).toBe(
      [
        "### Pre-flight: GO ✅  (attempt 2 · 41s · commit abc1234)",
        "| Check | Verdict | Time |",
        "|---|---|---|",
        "| check | GO | 6.1s |",
      ].join("\n"),
    );
  });

  test("a manual run says so instead of an attempt", () => {
    expect(prEvidence(record({ trigger: "manual" })).split("\n")[0]).toBe(
      "### Pre-flight: GO ✅  (manual run · 41s · commit abc1234)",
    );
  });

  test("a NO-GO run reads NO-GO", () => {
    const text = prEvidence(
      record({
        state: "nogo",
        results: [{ ...record().results[0]!, verdict: "nogo", exitCode: 1 }],
      }),
    );
    expect(text).toContain("### Pre-flight: NO-GO ❌");
    expect(text).toContain("| check | NO-GO | 6.1s |");
  });

  test("evidence from an earlier state of the branch says so", () => {
    const stale =
      "_Ran on an earlier state of this branch (commit abc1234); the branch has changed since._";
    expect(prEvidence(record(), { hash: "changed" }).split("\n").slice(0, 3)).toEqual([
      "### Pre-flight: GO ✅  (attempt 2 · 41s · commit abc1234)",
      stale,
      "| Check | Verdict | Time |",
    ]);
    expect(prEvidence(record(), { hash: "same" })).not.toContain(stale);
    expect(prEvidence(record())).not.toContain(stale);
  });
});

describe("launchGuard with the Inspector", () => {
  const NOT_CLEARED = "The Inspector hasn't cleared this commit. Launch anyway?";
  const go = record();
  const cur = { hash: "same" };
  const on = (latest: { state: string; fingerprint: string } | null) => ({ on: true, latest });
  test("flagged", () =>
    expect(launchGuard(go, cur, true, on({ state: "flagged", fingerprint: "same" }))).toBe(
      NOT_CLEARED,
    ));
  test("cleared on another fingerprint", () =>
    expect(launchGuard(go, cur, true, on({ state: "cleared", fingerprint: "old" }))).toBe(
      NOT_CLEARED,
    ));
  test("missing", () => expect(launchGuard(go, cur, true, on(null))).toBe(NOT_CLEARED));
  test("cleared on the current hash", () =>
    expect(launchGuard(go, cur, true, on({ state: "cleared", fingerprint: "same" }))).toBeNull());
  test("inspector off", () =>
    expect(launchGuard(go, cur, true, { on: false, latest: null })).toBeNull());
  test("works with checks unarmed", () =>
    expect(launchGuard(null, cur, false, on(null))).toBe(NOT_CLEARED));
  test("the pre-flight reason wins", () =>
    expect(launchGuard(null, cur, true, on(null))).toBe(NO_GO));
});
