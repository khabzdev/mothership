import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CheckRun {
  verdict: "go" | "nogo" | "skipped";
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Raw combined stdout and stderr, last 256 KB. The full stream is in `logPath`. */
  output: string;
  logPath: string;
}

const OUTPUT_CAP = 256 * 1024;

export function runCheck(opts: {
  command: string;
  cwd: string;
  timeoutMs: number;
  logPath: string;
  signal?: AbortSignal;
}): Promise<CheckRun> {
  const { command, cwd, timeoutMs, logPath, signal } = opts;
  const started = Date.now();

  return (async (): Promise<CheckRun> => {
    await mkdir(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath);
    const logClosed = new Promise<void>((resolve) => {
      log.on("close", resolve);
      log.on("error", () => resolve());
    });

    let output = "";
    const append = (chunk: Buffer) => {
      log.write(chunk);
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP * 2) output = output.slice(-OUTPUT_CAP);
    };
    const finish = async (
      verdict: CheckRun["verdict"],
      exitCode: number | null,
      timedOut: boolean,
    ): Promise<CheckRun> => {
      log.end();
      await logClosed;
      return {
        verdict,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        output: output.slice(-OUTPUT_CAP),
        logPath,
      };
    };

    if (signal?.aborted) return finish("skipped", null, false);

    return new Promise<CheckRun>((resolve) => {
      let timedOut = false;
      let aborted = false;
      let settled = false;
      const done = (verdict: CheckRun["verdict"], exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        void finish(verdict, exitCode, timedOut).then(resolve);
      };

      const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const killGroup = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeoutMs);
      const onAbort = () => {
        aborted = true;
        killGroup();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (err) => {
        append(Buffer.from(`${err.message}\n`));
        done("nogo", null);
      });
      child.on("close", (code) => {
        if (aborted) done("skipped", code);
        else if (timedOut) done("nogo", code);
        else done(code === 0 ? "go" : "nogo", code);
      });
    });
  })();
}

export type RunCheck = typeof runCheck;
