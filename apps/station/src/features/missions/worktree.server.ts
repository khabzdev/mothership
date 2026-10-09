import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_SLUG = 40;

/** `mothership/<goal-slug>-<id6>`: readable, unique per mission. */
export function branchName(goal: string, missionId: string): string {
  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/-+$/, "") || "mission";
  return `mothership/${slug}-${missionId.slice(0, 6)}`;
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
