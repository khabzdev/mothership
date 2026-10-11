import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { LaunchPlan } from "@spaceship/providers";
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
  savedToken = process.env.SPACESHIP_HOOK_TOKEN;
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.SPACESHIP_HOOK_TOKEN;
  else process.env.SPACESHIP_HOOK_TOKEN = savedToken;
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPid = (file: string): number => {
  try {
    return Number(readFileSync(file, "utf8").trim());
  } catch {
    return 0;
  }
};

/** Polls until the child has written a pid to the file (up to 5 s); returns 0 if it never does. */
const waitForPid = async (file: string): Promise<number> => {
  const deadline = Date.now() + 5000;
  let pid = readPid(file);
  while (!(pid > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    pid = readPid(file);
  }
  return pid;
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

  test("the station's own SPACESHIP_ variables never reach the command", async () => {
    process.env.SPACESHIP_HOOK_TOKEN = "x";
    const r = await runReview({
      plan: node("console.log(Object.keys(process.env).join(' '))", { env: { KEEP_ME: "1" } }),
      prompt: "",
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).not.toContain("SPACESHIP_");
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
    const dir = mkdtempSync(join(tmpdir(), "inspection-abort-"));
    try {
      const pidFile = join(dir, "grandchild.pid");
      const ac = new AbortController();
      const plan = node(
        `const fs = require('fs'); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(()=>{},1000)`,
      );
      const p = runReview({ plan, prompt: "x", timeoutMs: 20_000, signal: ac.signal });
      const grandchild = await waitForPid(pidFile);
      expect(grandchild).toBeGreaterThan(0);
      const abortedAt = Date.now();
      ac.abort();
      const r = await p;
      expect(r.ok).toBe(false);
      expect(Date.now() - abortedAt).toBeLessThan(3000);
      await new Promise((res) => setTimeout(res, 100));
      expect(alive(grandchild)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("settles on time when an escaped grandchild holds its output open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspection-escape-"));
    const pidFile = join(dir, "grandchild.pid");
    try {
      // The grandchild leads its own process group, so killing the run's group misses it.
      const plan = node(
        `const fs = require('fs'); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit', detached:true}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(()=>{},1000)`,
      );
      const started = Date.now();
      const r = await runReview({ plan, prompt: "x", timeoutMs: 300 });
      expect(r).toMatchObject({ ok: false, timedOut: true });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      const pid = readPid(pidFile);
      if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("settles soon after the command exits even when a grandchild keeps its output open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspection-exit-"));
    const pidFile = join(dir, "grandchild.pid");
    try {
      const plan = node(
        `const fs = require('fs'); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit', detached:true}); c.unref(); fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); process.stdout.write('done', () => process.exit(0))`,
      );
      const started = Date.now();
      const r = await runReview({ plan, prompt: "x", timeoutMs: 20_000 });
      expect(r).toMatchObject({ ok: true, stdout: "done", exitCode: 0 });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      const pid = readPid(pidFile);
      if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("multi-byte characters split across chunks come through whole", async () => {
    const r = await runReview({
      plan: node(
        "const b = Buffer.from('héllo ✓'); process.stdout.write(b.subarray(0, 2)); setTimeout(() => process.stdout.write(b.subarray(2)), 50)",
      ),
      prompt: "x",
      timeoutMs: 10_000,
    });
    expect(r.stdout).toBe("héllo ✓");
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
