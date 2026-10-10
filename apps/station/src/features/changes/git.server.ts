import { execFile } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, ChangesState } from "./model";

const run = promisify(execFile);
const git = async (cwd: string, args: string[]) =>
  (await run("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;

/** Most files the window lists, and the most of one diff it shows. */
const MAX_FILES = 300;
const MAX_DIFF = 200_000;

/**
 * What a crew member changed in `cwd` (agent-office's Changes window). In its own worktree that's
 * everything since it branched off the deck's checkout (`homeRef`), committed or not; in the deck's
 * shared checkout it's just what isn't committed yet.
 */
export async function readChanges(cwd: string, homeRef: string | null): Promise<ChangesState> {
  const branch = (await git(cwd, ["branch", "--show-current"])).trim() || "HEAD";
  const base = await diffBase(cwd, homeRef);
  const ahead = homeRef
    ? Number((await git(cwd, ["rev-list", "--count", `${base}..HEAD`])).trim())
    : 0;
  const subject = ahead ? (await git(cwd, ["log", "-1", "--format=%s"])).trim() : undefined;

  const uncommitted = new Set<string>();
  for (const line of (await git(cwd, ["status", "--porcelain", "-z"])).split("\0")) {
    if (line.length > 3) uncommitted.add(line.slice(3));
  }

  const files = new Map<string, ChangedFile>();
  const names = (await git(cwd, ["diff", "--name-status", "-z", "-M", base])).split("\0");
  for (let i = 0; i < names.length - 1;) {
    const code = names[i++]!;
    const status = code[0] as ChangedFile["status"];
    const from = status === "R" ? names[i++] : undefined;
    const path = names[i++]!;
    files.set(path, {
      path,
      ...(from && { from }),
      status,
      additions: 0,
      deletions: 0,
      binary: false,
      uncommitted: uncommitted.has(path),
    });
  }
  for (const line of (await git(cwd, ["diff", "--numstat", "-M", base])).split("\n")) {
    const [add, del, ...rest] = line.split("\t");
    const file = files.get(
      rest
        .join("\t")
        .replace(/^.*=> /, "")
        .replace(/[{}]/g, ""),
    );
    if (!file) continue;
    file.binary = add === "-";
    file.additions = Number(add) || 0;
    file.deletions = Number(del) || 0;
  }
  for (const path of (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)) {
    files.set(path, { path, status: "?", ...countLines(join(cwd, path)), uncommitted: true });
  }

  const all = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    branch,
    base: homeRef ?? "HEAD",
    ahead,
    ...(subject && { subject }),
    files: all.slice(0, MAX_FILES),
    more: Math.max(0, all.length - MAX_FILES),
  };
}

/** A new file's lines, all of them added; binary when it has a NUL byte or is too big to read. */
function countLines(file: string): { additions: number; deletions: 0; binary: boolean } {
  try {
    if (statSync(file).size > 1024 * 1024) return { additions: 0, deletions: 0, binary: true };
    const data = readFileSync(file);
    if (data.includes(0)) return { additions: 0, deletions: 0, binary: true };
    const text = data.toString("utf8");
    const additions = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
    return { additions, deletions: 0, binary: false };
  } catch {
    return { additions: 0, deletions: 0, binary: false };
  }
}

/** The commit readChanges and readDiff measure against: where HEAD left `homeRef`, else HEAD. */
export async function diffBase(cwd: string, homeRef: string | null): Promise<string> {
  return homeRef ? (await git(cwd, ["merge-base", "HEAD", homeRef])).trim() : "HEAD";
}

/** One changed file's unified diff against the same base as readChanges (`base`, when already known). */
export async function readDiff(
  cwd: string,
  homeRef: string | null,
  file: ChangedFile,
  base?: string,
): Promise<{ diff: string; truncated: boolean }> {
  let diff: string;
  if (file.status === "?") {
    // Untracked: diff it against nothing (git exits 1 when there are differences).
    diff = await run("git", ["-C", cwd, "diff", "--no-index", "--", "/dev/null", file.path], {
      maxBuffer: 16 * 1024 * 1024,
    }).then(
      (r) => r.stdout,
      (error: { stdout?: string }) => error.stdout ?? "",
    );
  } else {
    const from = base ?? (await diffBase(cwd, homeRef));
    const paths = file.from ? [file.from, file.path] : [file.path];
    diff = await git(cwd, ["diff", "-M", from, "--", ...paths]);
  }
  return diff.length > MAX_DIFF
    ? { diff: diff.slice(0, MAX_DIFF), truncated: true }
    : { diff, truncated: false };
}

/** `git add -A && git commit -m message` in the crew member's checkout. */
export async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["commit", "-q", "-m", message]);
}

/** Put one file back to its last commit, or delete it when it was never committed. */
export async function discardFile(cwd: string, file: ChangedFile): Promise<void> {
  if (file.status === "?") {
    rmSync(join(cwd, file.path), { force: true });
    return;
  }
  const paths = file.from ? [file.from, file.path] : [file.path];
  await git(cwd, ["restore", "--staged", "--worktree", "--source=HEAD", "--", ...paths]).catch(
    // A file added in the index only: there's nothing in HEAD to restore it from.
    () => git(cwd, ["rm", "-q", "-f", "--", file.path]),
  );
}

/** Throw away every uncommitted change and new file; commits stay. */
export async function discardAll(cwd: string): Promise<void> {
  await git(cwd, ["reset", "-q", "--hard", "HEAD"]);
  await git(cwd, ["clean", "-q", "-fd"]);
}
