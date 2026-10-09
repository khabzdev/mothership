import { execFile } from "node:child_process";

export interface ExecResult {
  /** Exit code; null when the command could not run (see `missing`/`timedOut`). */
  code: number | null;
  stdout: string;
  stderr: string;
  missing?: boolean;
  timedOut?: boolean;
}

export type Exec = (command: string, args: string[], timeoutMs?: number) => Promise<ExecResult>;

/** Run a command without a shell; never throws. */
export const exec: Exec = (command, args, timeoutMs = 5000) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr });
      const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (e.code === "ENOENT") return resolve({ code: null, stdout, stderr, missing: true });
      if (e.killed) return resolve({ code: null, stdout, stderr, timedOut: true });
      resolve({ code: typeof e.code === "number" ? e.code : 1, stdout, stderr });
    });
  });
