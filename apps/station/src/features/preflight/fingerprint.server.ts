import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * What a worktree holds right now: the sha1 of its HEAD, `status --porcelain`, `diff HEAD`, and
 * the contents of its untracked (not ignored) files, which the first three only name.
 * Two stops with the same hash mean nothing changed in between.
 */
export async function fingerprint(cwd: string): Promise<{ hash: string; commit: string }> {
  const git = (...args: string[]) =>
    run("git", ["-C", cwd, ...args], { maxBuffer: MAX_BUFFER }).then((r) => r.stdout);
  const [head, status, diff, others] = await Promise.all([
    git("rev-parse", "HEAD"),
    git("status", "--porcelain"),
    git("diff", "HEAD"),
    git("ls-files", "--others", "--exclude-standard", "-z"),
  ]);
  const hash = createHash("sha1")
    .update(head)
    .update("\0")
    .update(status)
    .update("\0")
    .update(diff);
  for (const path of others.split("\0").filter(Boolean).sort()) {
    hash
      .update("\0")
      .update(path)
      .update("\0")
      .update(await contentsOf(join(cwd, path)));
  }
  return { hash: hash.digest("hex"), commit: head.trim() };
}

/** A file's bytes, or a symlink's target; a file gone since git listed it counts as empty. */
async function contentsOf(path: string): Promise<Buffer | string> {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? await readlink(path) : await readFile(path);
  } catch {
    return "";
  }
}
