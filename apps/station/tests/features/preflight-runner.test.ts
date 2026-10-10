import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { runCheck } from "../../src/features/preflight/runner.server.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "preflight-runner-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (command: string, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
  runCheck({
    command,
    cwd: dir,
    timeoutMs: extra.timeoutMs ?? 20_000,
    logPath: join(dir, "logs", "check.log"),
    signal: extra.signal,
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runCheck", () => {
  test("exit 0 is GO", async () => {
    const r = await run("true");
    expect(r).toMatchObject({ verdict: "go", exitCode: 0, timedOut: false });
  });

  test("non-zero exit is NO-GO with its output", async () => {
    const r = await run("echo boom; exit 3");
    expect(r.verdict).toBe("nogo");
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("boom");
    expect(await readFile(r.logPath, "utf8")).toContain("boom");
  });

  test("timeout is NO-GO and marked timed out", async () => {
    const started = Date.now();
    const r = await run("sleep 5", { timeoutMs: 200 });
    expect(r.verdict).toBe("nogo");
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("kills the whole process group on timeout", async () => {
    // Timeout is generous enough for the shell to write the pid file under load.
    const pidFile = join(dir, "child.pid");
    const p = run(`sh -c 'sleep 30 & echo $! > "${pidFile}"; wait'`, { timeoutMs: 1500 });
    const r = await p;
    expect(r.timedOut).toBe(true);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(pid).toBeGreaterThan(0);
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      try {
        process.kill(pid, 0);
        await sleep(50);
      } catch (e) {
        expect((e as NodeJS.ErrnoException).code).toBe("ESRCH");
        gone = true;
      }
    }
    expect(gone).toBe(true);
  });

  test("a background child holding stdout doesn't keep a passing check waiting", async () => {
    const pidFile = join(dir, "bg.pid");
    const started = Date.now();
    const r = await run(`sh -c 'sleep 30 & echo $! > "${pidFile}"; exit 0'`, { timeoutMs: 5000 });
    expect(r).toMatchObject({ verdict: "go", exitCode: 0, timedOut: false });
    expect(Date.now() - started).toBeLessThan(2500);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      try {
        process.kill(pid, 0);
        await sleep(50);
      } catch {
        gone = true;
      }
    }
    expect(gone).toBe(true);
  });

  test("abort before finish is skipped", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const r = await run("sleep 5", { signal: ac.signal });
    expect(r.verdict).toBe("skipped");
  });

  test("an already aborted signal is skipped without running", async () => {
    const ac = new AbortController();
    ac.abort();
    const marker = join(dir, "ran");
    const r = await run(`touch "${marker}"`, { signal: ac.signal });
    expect(r.verdict).toBe("skipped");
    await expect(readFile(marker)).rejects.toThrow();
  });

  test("missing command is NO-GO with the shell's message", async () => {
    const r = await run("definitely-not-a-command-xyz");
    expect(r.verdict).toBe("nogo");
    expect(r.output.length).toBeGreaterThan(0);
  });

  test("keeps only the last 256 KB in memory but all of it in the log", async () => {
    const r = await run("head -c 400000 /dev/zero | tr '\\0' 'a'; echo END");
    expect(r.output.length).toBeLessThanOrEqual(256 * 1024);
    expect(r.output.endsWith("END\n")).toBe(true);
    expect((await readFile(r.logPath, "utf8")).length).toBeGreaterThan(400_000);
  });
});
