import { claudeCode } from "@spaceship/providers";
import { describe, expect, test } from "vite-plus/test";
import { hooksVerdict, pasteVerdict } from "../../smoke/claude-basics.ts";
import type { Signal } from "../../smoke/harness.ts";

const SESSION = "0b6f6c1e-5a3a-4d55-9a0e-3c1f2a7b9d10";

/** A hook as the receiver records it: through the real parser. */
function hook(event: string, extra: Record<string, unknown> = {}, session = SESSION): Signal {
  const payload = { hook_event_name: event, session_id: session, ...extra };
  const sessionId = claudeCode.sessionOf?.(payload);
  return {
    event,
    signal: claudeCode.parseHook(payload),
    ...(sessionId && { sessionId }),
    payload,
    at: 0,
  };
}

describe("hooksVerdict", () => {
  test("passes with SessionStart, UserPromptSubmit and a tool-less Stop, in any order", () => {
    const verdict = hooksVerdict([hook("UserPromptSubmit"), hook("SessionStart"), hook("Stop")]);
    expect(verdict.state).toBe("passed");
    expect(verdict.detail).toContain(SESSION.slice(0, 8));
  });

  test("fails naming the missing events", () => {
    const verdict = hooksVerdict([hook("SessionStart")]);
    expect(verdict).toEqual({
      state: "failed",
      detail: "missing UserPromptSubmit, Stop (saw SessionStart)",
    });
  });

  test("fails without any hook", () => {
    expect(hooksVerdict([])).toEqual({
      state: "failed",
      detail: "missing SessionStart, UserPromptSubmit, Stop (saw no hooks)",
    });
  });

  test("fails when an event has no valid session id", () => {
    const verdict = hooksVerdict([
      hook("SessionStart"),
      hook("UserPromptSubmit", {}, "not a session id!"),
      hook("Stop"),
    ]);
    expect(verdict).toEqual({ state: "failed", detail: "no valid session id on UserPromptSubmit" });
  });

  test("fails when every Stop followed a tool call", () => {
    const verdict = hooksVerdict([
      hook("SessionStart"),
      hook("UserPromptSubmit"),
      hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
      hook("Stop"),
    ]);
    expect(verdict).toEqual({
      state: "failed",
      detail: "no tool-less Stop: every turn used a tool",
    });
  });
});

describe("pasteVerdict", () => {
  const PROMPT = "Reply with the word pong.";
  const before = [
    hook("SessionStart"),
    hook("UserPromptSubmit", { prompt: "earlier" }),
    hook("Stop"),
  ];

  test("passes on the pasted prompt's submit and a later Stop", () => {
    const signals = [...before, hook("UserPromptSubmit", { prompt: PROMPT }), hook("Stop")];
    expect(pasteVerdict(signals, before.length, PROMPT).state).toBe("passed");
  });

  test("ignores hooks from before the paste", () => {
    expect(pasteVerdict(before, before.length, PROMPT)).toEqual({
      state: "failed",
      detail: "no UserPromptSubmit carrying the pasted prompt",
    });
  });

  test("fails when the submit carries another prompt", () => {
    const signals = [...before, hook("UserPromptSubmit", { prompt: "Reply with" }), hook("Stop")];
    expect(pasteVerdict(signals, before.length, PROMPT).state).toBe("failed");
  });

  test("fails without a Stop after the submit", () => {
    const signals = [...before, hook("UserPromptSubmit", { prompt: PROMPT })];
    expect(pasteVerdict(signals, before.length, PROMPT)).toEqual({
      state: "failed",
      detail: "prompt submitted but no Stop followed",
    });
  });
});
