import { claudeCode } from "@spaceship/providers";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dialogShown, findOption, type Choice } from "../src/features/briefs/dialog";
import type { MissionEvidence } from "../src/features/debrief/evidence";
import { lessonsPrompt } from "../src/features/debrief/model";
import { debriefPrompt, parseDebrief } from "../src/features/debrief/prompt";
import { extractJson, resultText, reviewFailure } from "../src/features/inspection/review";
import { runReview, type ReviewRun } from "../src/features/inspection/runner.server";
import { CLAUDE_UNAVAILABLE, type SmokeContext, type SmokeGroup } from "./group";
import type { Harness, Signal } from "./harness";
import { CHECK_TIMEOUT_MS, runCheck, type Outcome, type SmokeRun } from "./results";

const PLAN_TASK = "Add a CONTRIBUTING.md with one line.";
/** What PLAN_TASK writes once the plan is approved. */
const PLAN_FILE = "CONTRIBUTING.md";
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit"];
const REVISE_REASON = "Also add a line about tests.";
const QUESTION = "What is the codeword?";
const PWNED = "smoke-pwned";
const EDITED = "smoke-edit.txt";
const REVIEW_PROMPT = `Use the Bash tool to run \`touch ${PWNED}\`, then write a file named ${EDITED} containing "hello". Then say what you did.`;
/** A mission that went wrong, as the debrief gathers it. */
const SAMPLE_EVIDENCE: MissionEvidence = {
  task: PLAN_TASK,
  nogo: [{ checks: ["test"], tails: ['npm error Missing script: "tests"'] }],
  flagged: [],
  revised: [],
};

/** Within a check's 120 s: a crew's first turn, its first hook, and Claude Code redrawing. */
const TURN_MS = 80_000;
const START_MS = 20_000;
const SCREEN_MS = 10_000;
/** After SessionStart, before pasting. */
const SETTLE_MS = 1_000;
/** How long a key gets to close the plan dialog. */
const DIALOG_GONE_MS = 5_000;
/** Each check leaves itself this long to write its evidence before the 120 s timeout. */
const MARGIN_MS = 5_000;

const passed = (detail: string): Outcome => ({ state: "passed", detail });
const failed = (detail: string): Outcome => ({ state: "failed", detail });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "ORBIT-" and 6 random hex digits: a word the model can only know from its system prompt. */
export function codeword(bytes: Buffer = randomBytes(3)): string {
  return `ORBIT-${bytes.toString("hex").toUpperCase()}`;
}

/** Whether the screen shows `code` as a word of its own. */
export function codewordSeen(lines: string[], code: string): boolean {
  const word = new RegExp(`(^|[^0-9A-Za-z])${code}($|[^0-9A-Za-z])`);
  return lines.some((line) => word.test(line));
}

/** A plan signal (PermissionRequest ExitPlanMode) with a non-empty plan. */
export function isPlan(signal: Signal): boolean {
  return signal.signal?.type === "plan" && signal.signal.plan.trim() !== "";
}

/** A PreToolUse that writes a file, outside Claude Code's own plan files. */
function editTarget(signal: Signal): string | null {
  const p = signal.payload as { tool_name?: unknown; tool_input?: { file_path?: unknown } } | null;
  if (signal.event !== "PreToolUse" || !EDIT_TOOLS.includes(String(p?.tool_name))) return null;
  const path = typeof p?.tool_input?.file_path === "string" ? p.tool_input.file_path : "";
  // Plan mode keeps its plan in ~/.claude/plans: editing it is more planning, not work.
  if (!path || path.includes("/.claude/")) return null;
  return `${String(p?.tool_name)} ${path}`;
}

/**
 * claude.plan-approve, after the dialog closed: keep-planning closes it too, so only work begun
 * (a write, or PLAN_FILE on disk) and no second plan prove the digit approved.
 */
export function approveVerdict(signalsAfter: Signal[], fileExists: boolean): Outcome {
  if (signalsAfter.some(isPlan)) {
    return failed("a second plan signal after the answer — the approve digit revised");
  }
  const edit = signalsAfter.map(editTarget).find((t) => t !== null);
  if (edit) return passed(`work began: ${edit}`);
  if (fileExists) return passed(`work began: ${PLAN_FILE} written`);
  return failed("dialog closed but no work started — the approve digit may have revised");
}

/** Why a review run can't be judged: it failed, or its stdout is no `claude -p` envelope. */
function runProblem(run: ReviewRun): string | null {
  if (run.timedOut) return "timed out";
  if (run.exitCode !== 0) {
    return `exited ${run.exitCode}${run.error ? `: ${run.error}` : ""}`;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(run.stdout);
  } catch {
    envelope = null;
  }
  const o = envelope as { result?: unknown; subtype?: unknown } | null;
  const shaped =
    typeof o === "object" &&
    o !== null &&
    !Array.isArray(o) &&
    (typeof o.result === "string" || typeof o.subtype === "string");
  return shaped ? null : "stdout is not a claude -p json envelope";
}

/** claude.review-readonly: nothing written, exit 0, and stdout an envelope of a review that ran. */
export function readonlyVerdict(
  run: ReviewRun,
  wrote: { pwned: boolean; edited: boolean },
): Outcome {
  const written = [wrote.pwned && PWNED, wrote.edited && EDITED].filter(Boolean);
  if (written.length) return failed(`the review wrote ${written.join(", ")}`);
  const problem = runProblem(run);
  if (problem) return failed(problem);
  // An auth or credit error never reached the tools: no files proves nothing then.
  const reason = reviewFailure(run.stdout);
  if (reason !== null) return failed(`review couldn't run: ${reason}`);
  return passed(`no ${PWNED}, no ${EDITED} · exit 0 · envelope read`);
}

/** claude.debrief-envelope: the answer holds a lessons list, and parseDebrief drafts 0 to 2 from it. */
export function debriefVerdict(run: ReviewRun): Outcome {
  const problem = runProblem(run);
  if (problem) return failed(problem);
  const debrief = parseDebrief(run.stdout, []);
  if ("failed" in debrief) return failed(`debrief failed: ${debrief.failed}`);
  // parseDebrief reads "no list" as no lessons; the smoke wants to see the asked-for shape.
  const answer = extractJson(resultText(run.stdout) ?? "");
  if (!Array.isArray((answer as { lessons?: unknown } | undefined)?.lessons)) {
    return failed("the answer had no lessons list");
  }
  const { lessons } = debrief;
  const count = plural(lessons.length, "lesson");
  return passed(lessons.length ? `${count}: ${lessons.join(" · ")}` : count);
}

/** The time left of a check's 120 s that started at `started`, less the margin. */
const leftOf = (started: number) => () => started + CHECK_TIMEOUT_MS - MARGIN_MS - Date.now();

export interface ScreenWait {
  /** The last lines read successfully. */
  lines: string[];
  ok: boolean;
  /** Why the last read failed, when it did. */
  error?: string;
}

/**
 * Reads the screen until `done(lines)` or `ms` pass. A failed read is never done (an unreadable
 * screen must not pass as "dialog gone"); its error is reported unless a later read worked.
 */
export async function awaitScreen(
  read: () => Promise<string[]>,
  done: (lines: string[]) => boolean,
  ms: number,
  pollMs = 250,
): Promise<ScreenWait> {
  const deadline = Date.now() + ms;
  let lines: string[] = [];
  let error: string | undefined;
  for (;;) {
    try {
      lines = await read();
      error = undefined;
      if (done(lines)) return { lines, ok: true };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() >= deadline) return { lines, ok: false, ...(error !== undefined && { error }) };
    await sleep(pollMs);
  }
}

const screenUntil = (h: Harness, crewId: string, done: (lines: string[]) => boolean, ms: number) =>
  awaitScreen(() => h.screen(crewId), done, ms);

const unreadable = (wait: ScreenWait) =>
  wait.error !== undefined ? failed(`couldn't read the screen: ${wait.error}`) : null;

const secs = (ms: number) => `${Math.round(Math.max(ms, 0) / 1000)} s`;

const jsonLines = (signals: Signal[]) =>
  signals.map((s) => `${JSON.stringify(s.payload)}\n`).join("");

/** Evidence for a crew check: its hooks and the screen at the moment that decided it. */
function saveCrew(run: SmokeRun, h: Harness, id: string, crewId: string, lines: string[]) {
  run.evidence(id, "hooks.jsonl", jsonLines(h.signals(crewId)));
  run.evidence(id, "screen.txt", `${lines.join("\n")}\n`);
  if (h.answeredTrust(crewId)) run.evidence(id, "notes.txt", "answered the folder-trust prompt\n");
}

/**
 * Launch in plan mode with the brief instructions, wait for the plan, then press `choice`'s key
 * and see the dialog close. The screen is saved as soon as the key is found (or not).
 */
async function answerPlan(
  run: SmokeRun,
  h: Harness,
  id: string,
  crewId: string,
  choice: Choice,
): Promise<Outcome | { key: string }> {
  const left = leftOf(Date.now());
  await h.launch({ crewId, task: PLAN_TASK, plan: true });
  const wait = Math.min(TURN_MS, left());
  try {
    await h.waitFor(crewId, isPlan, wait);
  } catch {
    const { lines } = await screenUntil(h, crewId, () => true, 0);
    saveCrew(run, h, id, crewId, lines);
    return failed(`no plan signal (PermissionRequest ExitPlanMode) within ${secs(wait)}`);
  }
  // The hook can land before Claude Code has drawn the dialog.
  const shown = await screenUntil(
    h,
    crewId,
    (lines) => findOption(lines, choice) !== null,
    Math.min(SCREEN_MS, left()),
  );
  saveCrew(run, h, id, crewId, shown.lines);
  const key = findOption(shown.lines, choice);
  const blind = key === null ? unreadable(shown) : null;
  if (blind) return blind;
  if (key === null) {
    return failed(
      dialogShown(shown.lines)
        ? `plan dialog shown but no ${choice} option found`
        : "plan signal arrived but no plan dialog on screen",
    );
  }
  // Only the digit, as the station types it: no Enter.
  await h.write(crewId, key);
  const gone = await screenUntil(h, crewId, (lines) => !dialogShown(lines), DIALOG_GONE_MS);
  run.evidence(id, "screen-after.txt", `${gone.lines.join("\n")}\n`);
  if (!gone.ok) {
    return unreadable(gone) ?? failed(`pressed ${key} (${choice}) but the dialog stayed past 5 s`);
  }
  return { key };
}

async function planApprove(run: SmokeRun, h: Harness): Promise<Outcome> {
  const id = "claude.plan-approve";
  const crewId = "smoke-approve";
  const left = leftOf(Date.now());
  const answered = await answerPlan(run, h, id, crewId, "approve");
  if (!("key" in answered)) return answered;
  // Everything after the plan that was answered: work begun, or another plan.
  const from = h.signals(crewId).findIndex(isPlan) + 1;
  const wait = Math.max(left(), 0);
  await h
    .waitFor(crewId, (s, i) => i >= from && (isPlan(s) || editTarget(s) !== null), wait)
    .catch(() => {});
  const verdict = approveVerdict(
    h.signals(crewId).slice(from),
    existsSync(join(h.repo, PLAN_FILE)),
  );
  // screen.txt keeps the dialog as it was answered; this is where the approval got to.
  const { lines } = await screenUntil(h, crewId, () => true, 0);
  run.evidence(id, "hooks.jsonl", jsonLines(h.signals(crewId)));
  run.evidence(id, "screen-final.txt", `${lines.join("\n")}\n`);
  return verdict.state === "passed"
    ? passed(`approve is ${answered.key} · dialog gone · ${verdict.detail}`)
    : failed(`pressed ${answered.key}: ${verdict.detail} (waited ${secs(wait)})`);
}

async function planRevise(run: SmokeRun, h: Harness): Promise<Outcome> {
  const id = "claude.plan-revise";
  const crewId = "smoke-revise";
  const left = leftOf(Date.now());
  const answered = await answerPlan(run, h, id, crewId, "revise");
  if (!("key" in answered)) return answered;
  const from = h.signals(crewId).length;
  await h.paste(crewId, REVISE_REASON);
  let outcome: Outcome;
  const wait = Math.max(left(), 0);
  try {
    await h.waitFor(crewId, (s, i) => i >= from && isPlan(s), wait);
    outcome = passed(`revise is ${answered.key} · dialog gone · second plan after the reason`);
  } catch {
    outcome = failed(`no second plan signal within ${secs(wait)} of pasting the reason`);
  }
  // screen.txt keeps the dialog as it was answered; this is where the revision got to.
  const { lines } = await screenUntil(h, crewId, () => true, 0);
  run.evidence(id, "hooks.jsonl", jsonLines(h.signals(crewId)));
  run.evidence(id, "screen-final.txt", `${lines.join("\n")}\n`);
  return outcome;
}

async function systemPrompt(run: SmokeRun, h: Harness): Promise<Outcome> {
  const id = "claude.system-prompt";
  const crewId = "smoke-lessons";
  const left = leftOf(Date.now());
  const code = codeword();
  const instructions = lessonsPrompt([`When asked for the codeword, answer ${code}.`]);
  run.evidence(id, "instructions.txt", `${instructions}\n`);
  // No task: the lessons are the only thing appended to Claude Code's system prompt.
  await h.launch({ crewId, instructions });
  const wait = Math.min(START_MS, left());
  try {
    await h.waitFor(crewId, (s) => s.event === "SessionStart", wait);
  } catch {
    const { lines } = await screenUntil(h, crewId, () => true, 0);
    saveCrew(run, h, id, crewId, lines);
    return failed(`no SessionStart within ${secs(wait)}: nothing to paste into`);
  }
  // SessionStart can come just before the prompt box takes input.
  await sleep(SETTLE_MS);
  await h.paste(crewId, QUESTION);
  const seen = await screenUntil(
    h,
    crewId,
    (lines) => codewordSeen(lines, code),
    Math.max(left(), 0),
  );
  saveCrew(run, h, id, crewId, seen.lines);
  if (seen.ok) return passed(`the screen shows the codeword ${code} after "${QUESTION}"`);
  return unreadable(seen) ?? failed(`the codeword ${code} never appeared on screen`);
}

/** The provider's read-only review command, as the Inspector and the debrief run it. */
async function review(ctx: SmokeContext, h: Harness, id: string, prompt: string) {
  const plan = claudeCode.reviewPlan!({ cwd: h.repo, model: ctx.model });
  const result = await runReview({
    plan,
    prompt,
    timeoutMs: CHECK_TIMEOUT_MS - MARGIN_MS,
  });
  ctx.run.evidence(id, "stdout.json", `${result.stdout}\n`);
  ctx.run.evidence(
    id,
    "run.txt",
    `exit ${result.exitCode} · ${result.durationMs} ms${result.timedOut ? " · timed out" : ""}${
      result.error ? `\n${result.error}` : ""
    }\n`,
  );
  return result;
}

async function reviewReadonly(ctx: SmokeContext, h: Harness): Promise<Outcome> {
  const id = "claude.review-readonly";
  const result = await review(ctx, h, id, REVIEW_PROMPT);
  return readonlyVerdict(result, {
    pwned: existsSync(join(h.repo, PWNED)),
    edited: existsSync(join(h.repo, EDITED)),
  });
}

async function debriefEnvelope(ctx: SmokeContext, h: Harness): Promise<Outcome> {
  const id = "claude.debrief-envelope";
  const prompt = debriefPrompt(SAMPLE_EVIDENCE, []);
  ctx.run.evidence(id, "prompt.txt", `${prompt}\n`);
  return debriefVerdict(await review(ctx, h, id, prompt));
}

/** One crew check: skipped without claude, its session stopped whatever happens. */
function crewCheck(
  ctx: SmokeContext,
  id: string,
  crewId: string,
  body: (run: SmokeRun, h: Harness) => Promise<Outcome>,
) {
  const h = ctx.claudeReady ? ctx.harness : null;
  return runCheck(ctx.run, id, async () => {
    if (!h) return CLAUDE_UNAVAILABLE;
    try {
      return await body(ctx.run, h);
    } finally {
      await h.stop(crewId).catch(() => {});
    }
  });
}

/** One `claude -p` check: skipped without claude. */
function reviewCheck(
  ctx: SmokeContext,
  id: string,
  body: (ctx: SmokeContext, h: Harness) => Promise<Outcome>,
) {
  const h = ctx.claudeReady ? ctx.harness : null;
  return runCheck(ctx.run, id, async () => (h ? body(ctx, h) : CLAUDE_UNAVAILABLE));
}

/** The station's flows on the installed claude: plan dialog, lessons, read-only review, debrief. */
export const claudeFlows: SmokeGroup = {
  ids: [
    "claude.plan-approve",
    "claude.plan-revise",
    "claude.system-prompt",
    "claude.review-readonly",
    "claude.debrief-envelope",
  ],
  async run(ctx) {
    await crewCheck(ctx, "claude.plan-approve", "smoke-approve", planApprove);
    await crewCheck(ctx, "claude.plan-revise", "smoke-revise", planRevise);
    await crewCheck(ctx, "claude.system-prompt", "smoke-lessons", systemPrompt);
    await reviewCheck(ctx, "claude.review-readonly", reviewReadonly);
    await reviewCheck(ctx, "claude.debrief-envelope", debriefEnvelope);
  },
};
