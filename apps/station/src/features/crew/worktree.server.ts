import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_SLUG = 40;

/** `spaceship/<goal-slug>-<id6>`: readable, unique per mission. */
export function branchName(goal: string, missionId: string): string {
  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/-+$/, "") || "mission";
  return `spaceship/${slug}-${missionId.slice(0, 6)}`;
}

/** Create (or reuse) a git worktree at `path` on a new branch from HEAD. */
export async function createWorktree(options: {
  repoPath: string;
  path: string;
  branch: string;
}): Promise<{ path: string; branch: string }> {
  const { repoPath, path, branch } = options;
  if (existsSync(path)) {
    const { stdout } = await run("git", ["-C", path, "branch", "--show-current"]);
    if (stdout.trim() === branch) return { path, branch };
    throw new Error(`Worktree path is taken by another branch: ${path}`);
  }
  try {
    await run("git", ["-C", repoPath, "rev-parse", "--verify", "HEAD"]);
  } catch {
    throw new Error(`The repo needs at least one commit before a mission can start: ${repoPath}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  await run("git", ["-C", repoPath, "worktree", "add", "-b", branch, path, "HEAD"]);
  return { path, branch };
}

export interface WorktreeState {
  /** The worktree folder is gone (deleted outside the station). */
  missing: boolean;
  /** Files with uncommitted changes. */
  dirty: number;
  /** Commits only this branch has: on no remote, and not in the deck's own checkout. */
  unpushed: number;
}

/** What sending a crew member home would throw away (agent-office's worktree check). */
export async function worktreeState(repoPath: string, path: string): Promise<WorktreeState> {
  if (!existsSync(path)) return { missing: true, dirty: 0, unpushed: 0 };
  const status = await run("git", ["-C", path, "status", "--porcelain"]);
  const dirty = status.stdout.split("\n").filter(Boolean).length;
  const { stdout: home } = await run("git", ["-C", repoPath, "rev-parse", "HEAD"]);
  const ahead = await run("git", [
    "-C",
    path,
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    "--remotes",
    home.trim(),
  ]);
  return { missing: false, dirty, unpushed: Number(ahead.stdout.trim()) || 0 };
}

/** Remove a crew member's worktree, and its branch too when `deleteBranch`. */
export async function removeWorktree(options: {
  repoPath: string;
  path: string;
  branch: string;
  deleteBranch: boolean;
}): Promise<void> {
  const { repoPath, path, branch, deleteBranch } = options;
  if (existsSync(path)) await run("git", ["-C", repoPath, "worktree", "remove", "--force", path]);
  await run("git", ["-C", repoPath, "worktree", "prune"]);
  if (deleteBranch) await run("git", ["-C", repoPath, "branch", "-D", branch]).catch(() => {});
}
