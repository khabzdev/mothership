import { spawn } from "node:child_process";
import type { LaunchPlan } from "@mothership/providers";

/** How long one review may run. */
export const REVIEW_TIMEOUT_MS = 300_000;
/** The most review output kept; the rest is dropped. */
export const REVIEW_OUTPUT_CAP = 1024 * 1024;
const STDERR_TAIL = 2048;

export interface ReviewRun {
  ok: boolean;
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
  durationMs: number;
}

/** Runs the provider's read-only review command with the prompt on stdin, killing it on timeout or abort. */
export function runReview(opts: {
  plan: LaunchPlan;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ReviewRun> {
  const { plan, prompt, timeoutMs, signal } = opts;
  const started = Date.now();

  return new Promise<ReviewRun>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let spawnError: string | undefined;
    let settled = false;

    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const ok = exitCode === 0 && !timedOut && !aborted && !spawnError;
      const reason = spawnError
        ? spawnError
        : timedOut
          ? "Timed out"
          : aborted
            ? "Aborted"
            : stderr.trim() || (exitCode !== 0 ? `Exited with code ${exitCode}` : "");
      resolve({
        ok,
        stdout,
        exitCode,
        timedOut,
        ...(!ok && reason && { error: reason }),
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    let killGroup = () => {};
    const onAbort = () => {
      aborted = true;
      killGroup();
    };

    if (signal?.aborted) {
      aborted = true;
      done(null);
      return;
    }

    // The station's own secrets stay out of the agent's environment.
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("MOTHERSHIP_")) env[key] = value;
    }
    Object.assign(env, plan.env);

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < REVIEW_OUTPUT_CAP) {
        stdout = (stdout + chunk.toString("utf8")).slice(0, REVIEW_OUTPUT_CAP);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });
    // A command that exits without reading its input closes the pipe on us.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    child.on("error", (err) => {
      spawnError = err.message;
      done(null);
    });
    child.on("close", (code) => {
      // Anything the command left running goes with its group.
      killGroup();
      done(code);
    });
  });
}

export type RunReview = typeof runReview;
