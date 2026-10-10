import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { LaunchPlan } from "@mothership/providers";
import { REVIEW_OUTPUT_CAP, runReview } from "../../src/features/inspection/runner.server.ts";

const node = (script: string, extra: Partial<LaunchPlan> = {}): LaunchPlan => ({
  command: process.execPath,
  args: ["-e", script],
  cwd: process.cwd(),
  env: {},
  ...extra,
});

const ECHO = "process.stdin.pipe(process.stdout)";

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env.MOTHERSHIP_HOOK_TOKEN;
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.MOTHERSHIP_HOOK_TOKEN;
  else process.env.MOTHERSHIP_HOOK_TOKEN = savedToken;
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("runReview", () => {
  test("hands the prompt to the command on stdin and returns its output", async () => {
    const r = await runReview({
      plan: node(ECHO),
      prompt: "review this\nplease",
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("review this\nplease");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  test("the station's own MOTHERSHIP_ variables never reach the command", async () => {
    process.env.MOTHERSHIP_HOOK_TOKEN = "x";
    const r = await runReview({
      plan: node("console.log(Object.keys(process.env).join(' '))", { env: { KEEP_ME: "1" } }),
      prompt: "",
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).not.toContain("MOTHERSHIP_");
    expect(r.stdout).toContain("KEEP_ME");
  });

  test("a non-zero exit is not ok and keeps stderr", async () => {
    const r = await runReview({
      plan: node("console.error('bad things'); process.exit(3)"),
      prompt: "x",
      timeoutMs: 10_000,
    });
    expect(r).toMatchObject({ ok: false, exitCode: 3, timedOut: false });
    expect(r.error).toContain("bad things");
  });

  test("a run past its time limit is killed and marked timed out", async () => {
    const started = Date.now();
    const r = await runReview({
      plan: node("setInterval(() => {}, 1000)"),
      prompt: "x",
      timeoutMs: 200,
    });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("an abort stops the run and its whole process group", async () => {
    const ac = new AbortController();
    const plan = node(
      "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'}); console.log(c.pid); setInterval(()=>{},1000)",
    );
    const started = Date.now();
    const p = runReview({ plan, prompt: "x", timeoutMs: 20_000, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 400));
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
    const grandchild = Number(r.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 100));
    expect(alive(grandchild)).toBe(false);
  });

  test("an already aborted signal never starts the command", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runReview({
      plan: node(ECHO),
      prompt: "x",
      timeoutMs: 10_000,
      signal: ac.signal,
    });
    expect(r.ok).toBe(false);
  });

  test("a missing command is a failed run, not a throw", async () => {
    const r = await runReview({
      plan: { command: "/nope/claude", args: [], cwd: process.cwd(), env: {} },
      prompt: "x",
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test("output beyond the cap is dropped", async () => {
    const r = await runReview({
      plan: node("process.stdout.write('a'.repeat(2 * 1024 * 1024))"),
      prompt: "x",
      timeoutMs: 20_000,
    });
    expect(r.stdout.length).toBeLessThanOrEqual(REVIEW_OUTPUT_CAP);
    expect(r.stdout.length).toBeGreaterThan(0);
  });
});
