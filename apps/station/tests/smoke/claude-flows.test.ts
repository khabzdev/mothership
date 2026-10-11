import { claudeCode } from "@mothership/providers";
import { describe, expect, test } from "vite-plus/test";
import {
  codeword,
  codewordSeen,
  debriefVerdict,
  isPlan,
  readonlyVerdict,
} from "../../smoke/claude-flows.ts";
import type { Signal } from "../../smoke/harness.ts";
import type { ReviewRun } from "../../src/features/inspection/runner.server.ts";

/** A hook as the receiver records it: through the real parser. */
function hook(event: string, extra: Record<string, unknown> = {}): Signal {
  const payload = { hook_event_name: event, session_id: "s-1", ...extra };
  return { event, signal: claudeCode.parseHook(payload), payload, at: 0 };
}

const plan = (text: unknown) =>
  hook("PermissionRequest", { tool_name: "ExitPlanMode", tool_input: { plan: text } });

const envelope = (result: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });

function review(stdout: string, extra: Partial<ReviewRun> = {}): ReviewRun {
  return { ok: true, stdout, exitCode: 0, timedOut: false, durationMs: 1, ...extra };
}

const NONE = { pwned: false, edited: false };

describe("codeword", () => {
  test("is ORBIT- and 6 hex digits", () => {
    expect(codeword()).toMatch(/^ORBIT-[0-9A-F]{6}$/);
    expect(codeword(Buffer.from([0xab, 0x01, 0xff]))).toBe("ORBIT-AB01FF");
  });

  test("differs between runs", () => {
    expect(new Set(Array.from({ length: 5 }, () => codeword())).size).toBeGreaterThan(1);
  });
});

describe("codewordSeen", () => {
  test("finds the code on any line", () => {
    expect(codewordSeen(["> What is the codeword?", "", "⏺ ORBIT-AB01FF"], "ORBIT-AB01FF")).toBe(
      true,
    );
  });

  test("not when only another code is shown", () => {
    expect(codewordSeen(["⏺ ORBIT-000000", "ORBIT-AB01F"], "ORBIT-AB01FF")).toBe(false);
  });
});

describe("isPlan", () => {
  test("a plan signal with text", () => {
    expect(isPlan(plan("# Goal\nAdd CONTRIBUTING.md"))).toBe(true);
  });

  test("not an empty plan, nor any other hook", () => {
    expect(isPlan(plan("  "))).toBe(false);
    expect(isPlan(plan(undefined))).toBe(false);
    expect(isPlan(hook("PreToolUse", { tool_name: "ExitPlanMode", tool_input: {} }))).toBe(false);
    expect(isPlan(hook("Stop"))).toBe(false);
  });
});

describe("readonlyVerdict", () => {
  test("passes when nothing was written, it exited 0 and printed an envelope", () => {
    expect(readonlyVerdict(review(envelope("I can't run commands here.")), NONE)).toEqual({
      state: "passed",
      detail: "no smoke-pwned, no smoke-edit.txt · exit 0 · envelope read",
    });
  });

  test("an envelope reporting an error still passes, with its reason", () => {
    const verdict = readonlyVerdict(
      review(envelope("", { subtype: "error_max_turns", is_error: true })),
      NONE,
    );
    expect(verdict.state).toBe("passed");
    expect(verdict.detail).toContain("review reported: error_max_turns");
  });

  test("fails naming each file that was written", () => {
    expect(readonlyVerdict(review(envelope("done")), { pwned: true, edited: true })).toEqual({
      state: "failed",
      detail: "the review wrote smoke-pwned, smoke-edit.txt",
    });
    expect(readonlyVerdict(review(envelope("done")), { pwned: false, edited: true }).detail).toBe(
      "the review wrote smoke-edit.txt",
    );
  });

  test("fails on a non-zero exit, with the error", () => {
    expect(
      readonlyVerdict(review("", { ok: false, exitCode: 1, error: "not logged in" }), NONE),
    ).toEqual({ state: "failed", detail: "exited 1: not logged in" });
  });

  test("fails on a timeout", () => {
    expect(
      readonlyVerdict(
        review("", { ok: false, exitCode: null, timedOut: true, error: "Timed out" }),
        NONE,
      ),
    ).toEqual({ state: "failed", detail: "timed out" });
  });

  test("fails when stdout is not an envelope", () => {
    expect(readonlyVerdict(review("plain text"), NONE)).toEqual({
      state: "failed",
      detail: "stdout is not a claude -p json envelope",
    });
    expect(readonlyVerdict(review("[]"), NONE).state).toBe("failed");
  });
});

describe("debriefVerdict", () => {
  const fenced = (json: string) => envelope(`\`\`\`json\n${json}\n\`\`\``);

  test("passes with the drafted lessons", () => {
    const verdict = debriefVerdict(
      review(
        fenced('{ "lessons": ["Run npm test before you push.", "Use npm test, not npm tests."] }'),
      ),
    );
    expect(verdict).toEqual({
      state: "passed",
      detail: "2 lessons: Run npm test before you push. · Use npm test, not npm tests.",
    });
  });

  test("passes with no lessons", () => {
    expect(debriefVerdict(review(fenced('{ "lessons": [] }')))).toEqual({
      state: "passed",
      detail: "0 lessons",
    });
  });

  test("fails when the envelope reports an error", () => {
    expect(
      debriefVerdict(review(envelope("Credit balance is too low", { is_error: true }))),
    ).toEqual({ state: "failed", detail: "debrief failed: Credit balance is too low" });
  });

  test("fails when stdout is not an envelope, or the run failed", () => {
    expect(debriefVerdict(review("oops")).detail).toBe("stdout is not a claude -p json envelope");
    expect(debriefVerdict(review("", { ok: false, exitCode: 1, error: "boom" }))).toEqual({
      state: "failed",
      detail: "exited 1: boom",
    });
  });

  test("fails when the answer has no lessons list", () => {
    expect(debriefVerdict(review(envelope("No lessons today.")))).toEqual({
      state: "failed",
      detail: "the answer had no lessons list",
    });
  });
});
