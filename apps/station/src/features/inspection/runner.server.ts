import { spawn } from "node:child_process";
import type { LaunchPlan } from "@spaceship/providers";

/** How long one review may run. */
export const REVIEW_TIMEOUT_MS = 300_000;
/** The most review output kept; the rest is dropped. */
export const REVIEW_OUTPUT_CAP = 1024 * 1024;
const STDERR_TAIL = 2048;
/** After the command exits (or is killed), how long its output may keep coming before we stop listening. */
const EXIT_GRACE_MS = 250;

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
    let grace: ReturnType<typeof setTimeout> | undefined;
    let stopListening = () => {};

    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      stopListening();
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

    let killGroup = () => {};
    // Killed: settle shortly even if something outside the group still holds the output open.
    const stop = () => {
      killGroup();
      clearTimeout(grace);
      grace = setTimeout(() => done(null), EXIT_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };

    if (signal?.aborted) {
      aborted = true;
      done(null);
      return;
    }

    // The station's own secrets stay out of the agent's environment.
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("SPACESHIP_")) env[key] = value;
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
    stopListening = () => {
      child.stdout.destroy();
      child.stderr.destroy();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < REVIEW_OUTPUT_CAP) {
        stdout = (stdout + chunk).slice(0, REVIEW_OUTPUT_CAP);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    // A command that exits without reading its input closes the pipe on us.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    child.on("error", (err) => {
      spawnError = err.message;
      done(null);
    });
    // The command is through when it exits. Anything it left running in the background (and
    // holding its output open) gets a moment to finish writing, then goes with its group.
    child.on("exit", (code) => {
      clearTimeout(grace);
      grace = setTimeout(() => {
        killGroup();
        done(code);
      }, EXIT_GRACE_MS);
    });
    child.on("close", (code) => {
      // Anything the command left running goes with its group.
      killGroup();
      done(code);
    });
  });
}

export type RunReview = typeof runReview;
