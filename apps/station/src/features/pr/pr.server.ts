import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Runs a command in a folder and returns its stdout (git and gh; swapped out in tests). */
export type Exec = (command: string, args: string[], cwd: string) => Promise<string>;

const run = promisify(execFile);
export const exec: Exec = async (command, args, cwd) =>
  (await run(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 })).stdout;

export interface PrRequest {
  /** The crew member's own worktree and branch, and the deck checkout it branched from. */
  cwd: string;
  branch: string;
  repoPath: string;
  task: string;
  /** The approved brief, as markdown (`prBrief`). */
  brief?: string;
  name: string;
  console: string;
  /** The latest pre-flight, as markdown (`prEvidence`). */
  evidence?: string;
  /** The latest inspection, as markdown (`prInspection`). */
  inspection?: string;
}

const MAX_TITLE = 72;

/** A PR title from the task's first line, or the branch when there's no task. */
export function prTitle(task: string, branch: string): string {
  const line = task.split("\n")[0]?.trim() ?? "";
  if (!line)
    return branch
      .replace(/^mothership\//, "")
      .replace(/-[0-9a-f]{6}$/, "")
      .replace(/-/g, " ");
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

/** The PR body: the task as given, the approved brief, what was committed, and who opened it. */
export function prBody(request: PrRequest, commits: string[]): string {
  const task = request.task.trim();
  return [
    task ? `## Task\n\n${task.replace(/^/gm, "> ")}` : "",
    request.brief ?? "",
    commits.length ? `## Commits\n\n${commits.map((c) => `- ${c}`).join("\n")}` : "",
    request.evidence ?? "",
    request.inspection ?? "",
    `Opened from Mothership by ${request.name} at ${request.console}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The `gh` args that print the URL of the branch's open pull request (empty when none). */
export const openPrForBranchArgs = (branch: string): string[] => [
  "pr",
  "view",
  branch,
  "--json",
  "url,state",
  "--jq",
  'select(.state == "OPEN") | .url',
];

/**
 * Push the crew member's branch and open a pull request into the branch the deck has checked out
 * (agent-office's O). A PR that's already open for the branch is returned instead.
 */
export async function openPullRequest(request: PrRequest, x: Exec = exec): Promise<string> {
  const { cwd, branch, repoPath } = request;
  const existing = await x("gh", openPrForBranchArgs(branch), cwd).catch(() => "");
  if (existing.trim()) return existing.trim();

  const dirty = (await x("git", ["status", "--porcelain"], cwd)).trim();
  if (dirty) throw new Error("Commit first: there are uncommitted changes (C to see them)");
  const base = (await x("git", ["branch", "--show-current"], repoPath)).trim();
  if (!base) throw new Error("The deck's checkout isn't on a branch to open a pull request into");
  const commits = (await x("git", ["log", "--reverse", "--format=%s", `${base}..HEAD`], cwd))
    .split("\n")
    .filter(Boolean);
  if (!commits.length) throw new Error(`Nothing on ${branch} that ${base} lacks yet`);

  await x("git", ["push", "-u", "origin", `HEAD:refs/heads/${branch}`], cwd);
  const out = await x(
    "gh",
    [
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      base,
      "--title",
      prTitle(request.task, branch),
      "--body",
      prBody(request, commits),
    ],
    cwd,
  );
  const url = out
    .trim()
    .split("\n")
    .reverse()
    .find((l) => /^https?:\/\//.test(l));
  if (!url) throw new Error("gh didn't say where the pull request is");
  return url;
}
