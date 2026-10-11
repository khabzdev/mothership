import { checkClaude } from "../src/app/diagnostics.server";
import { exec } from "../src/app/exec.server";
import { CLAUDE_UNAVAILABLE, type SmokeContext, type SmokeGroup } from "./group";
import type { Harness, Signal } from "./harness";
import { runCheck, type Outcome, type SmokeRun } from "./results";

const CREW = "smoke-basics";
const HOOKS_TASK = "Reply with the word ready and stop.";
const PONG = "Reply with the word pong.";
const REQUIRED = ["SessionStart", "UserPromptSubmit", "Stop"];
/** Within a check's 120 s: how long a turn may take, then how long late (async) hooks get. */
const TURN_MS = 90_000;
const SETTLE_MS = 5_000;

const passed = (detail: string): Outcome => ({ state: "passed", detail });
const failed = (detail: string): Outcome => ({ state: "failed", detail });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `done()` or `ms` pass. */
async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await sleep(100);
}

/** Whether some Stop ended a turn without a tool call since its prompt. */
function toolLessStop(signals: Signal[]): boolean {
  let tool = false;
  for (const { event } of signals) {
    if (event === "UserPromptSubmit") tool = false;
    else if (event === "PreToolUse") tool = true;
    else if (event === "Stop" && !tool) return true;
  }
  return false;
}

/** claude.hooks: SessionStart, UserPromptSubmit and Stop (any order), with session ids. */
export function hooksVerdict(signals: Signal[]): Outcome {
  const seen = new Set(signals.map((s) => s.event));
  const missing = REQUIRED.filter((event) => !seen.has(event));
  if (missing.length) {
    const saw = seen.size ? [...seen].join(", ") : "no hooks";
    return failed(`missing ${missing.join(", ")} (saw ${saw})`);
  }
  for (const event of REQUIRED) {
    if (!signals.some((s) => s.event === event && s.sessionId)) {
      return failed(`no valid session id on ${event}`);
    }
  }
  if (!toolLessStop(signals)) return failed("no tool-less Stop: every turn used a tool");
  const session = signals.find((s) => s.sessionId)!.sessionId!;
  return passed(`${REQUIRED.join(", ")} · session ${session.slice(0, 8)}`);
}

const promptOf = (payload: unknown) => {
  const prompt = (payload as { prompt?: unknown }).prompt;
  return typeof prompt === "string" ? prompt.trim() : undefined;
};

/** claude.paste-submit: after `from`, a UserPromptSubmit carrying `prompt`, then a Stop. */
export function pasteVerdict(signals: Signal[], from: number, prompt: string): Outcome {
  const after = signals.slice(from);
  const submit = after.findIndex(
    (s) => s.event === "UserPromptSubmit" && promptOf(s.payload) === prompt,
  );
  if (submit < 0) return failed("no UserPromptSubmit carrying the pasted prompt");
  if (!after.slice(submit + 1).some((s) => s.event === "Stop")) {
    return failed("prompt submitted but no Stop followed");
  }
  return passed(`UserPromptSubmit "${prompt}" then Stop`);
}

const jsonLines = (signals: Signal[]) =>
  signals.map((s) => `${JSON.stringify(s.payload)}\n`).join("");

async function saveScreen(run: SmokeRun, h: Harness, id: string) {
  const lines = await h.screen(CREW).catch((error: Error) => [`(no screen: ${error.message})`]);
  run.evidence(id, "screen.txt", `${lines.join("\n")}\n`);
}

async function claudeVersion(ctx: SmokeContext): Promise<Outcome> {
  // The station's own diagnostics: same version form, and only loggedIn and authMethod kept.
  const claude = await checkClaude({ exec });
  ctx.versions.claude = claude.version ?? null;
  const detail = claude.detail ?? claude.status;
  ctx.run.evidence("claude.version", "diagnostics.txt", `${claude.status}: ${detail}\n`);
  if (claude.status !== "ok") return failed(claude.fix ? `${detail} · ${claude.fix}` : detail);
  if (!ctx.harness) return failed(`${detail} · ${ctx.harnessError}`);
  ctx.claudeReady = true;
  return passed(detail);
}

async function hooks(run: SmokeRun, h: Harness): Promise<Outcome> {
  const id = "claude.hooks";
  await h.launch({ crewId: CREW, task: HOOKS_TASK });
  try {
    await h.waitFor(CREW, (s) => s.event === "Stop", TURN_MS);
    // Hooks post asynchronously: give the others a moment to land.
    await until(() => hooksVerdict(h.signals(CREW)).state === "passed", SETTLE_MS);
  } catch {
    // No Stop: the verdict says what arrived.
  }
  run.evidence(id, "hooks.jsonl", jsonLines(h.signals(CREW)));
  await saveScreen(run, h, id);
  return hooksVerdict(h.signals(CREW));
}

/** Pastes into the session claude.hooks started, once its first turn has ended. */
async function pasteSubmit(run: SmokeRun, h: Harness): Promise<Outcome> {
  const id = "claude.paste-submit";
  if (!h.signals(CREW).some((s) => s.event === "Stop")) {
    return failed("no idle session to paste into (claude.hooks saw no Stop)");
  }
  const from = h.signals(CREW).length;
  await h.paste(CREW, PONG);
  try {
    await h.waitFor(CREW, (s, i) => i >= from && s.event === "Stop", TURN_MS);
    await until(() => pasteVerdict(h.signals(CREW), from, PONG).state === "passed", SETTLE_MS);
  } catch {
    // No Stop: the verdict says what arrived.
  }
  run.evidence(id, "hooks.jsonl", jsonLines(h.signals(CREW).slice(from)));
  await saveScreen(run, h, id);
  return pasteVerdict(h.signals(CREW), from, PONG);
}

/** claude.version, claude.hooks, claude.paste-submit: the installed claude and its hooks. */
export const claudeBasics: SmokeGroup = {
  ids: ["claude.version", "claude.hooks", "claude.paste-submit"],
  async run(ctx) {
    const { run } = ctx;
    await runCheck(run, "claude.version", () => claudeVersion(ctx));
    const h = ctx.claudeReady ? ctx.harness : null;
    try {
      await runCheck(run, "claude.hooks", async () => (h ? hooks(run, h) : CLAUDE_UNAVAILABLE));
      await runCheck(run, "claude.paste-submit", async () =>
        h ? pasteSubmit(run, h) : CLAUDE_UNAVAILABLE,
      );
    } finally {
      await h?.stop(CREW).catch(() => {});
    }
  },
};
