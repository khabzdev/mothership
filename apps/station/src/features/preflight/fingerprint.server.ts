import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * What a worktree holds right now: the sha1 of its HEAD, `status --porcelain` and `diff HEAD`.
 * Two stops with the same hash mean nothing changed in between.
 */
export async function fingerprint(cwd: string): Promise<{ hash: string; commit: string }> {
  const git = (...args: string[]) =>
    run("git", ["-C", cwd, ...args], { maxBuffer: MAX_BUFFER }).then((r) => r.stdout);
  const [head, status, diff] = await Promise.all([
    git("rev-parse", "HEAD"),
    git("status", "--porcelain"),
    git("diff", "HEAD"),
  ]);
  const hash = createHash("sha1")
    .update(head)
    .update("\0")
    .update(status)
    .update("\0")
    .update(diff)
    .digest("hex");
  return { hash, commit: head.trim() };
}
