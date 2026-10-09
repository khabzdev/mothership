import { asc } from "drizzle-orm";
import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { Db } from "../../shared/db/client.server";
import { decks } from "../../shared/db/schema";
import type { Deck } from "./model";

const run = promisify(execFile);

/** Dock a git repo as a deck (or refresh an already docked one). */
export async function dockRepo(db: Db, path: string): Promise<Deck> {
  const root = await repoRoot(path);
  const modules = await topLevelModules(root);
  return db
    .insert(decks)
    .values({ id: crypto.randomUUID(), name: basename(root), repoPath: root, modules })
    .onConflictDoUpdate({ target: decks.repoPath, set: { name: basename(root), modules } })
    .returning()
    .get();
}

export async function listDecks(db: Db): Promise<Deck[]> {
  return db.select().from(decks).orderBy(asc(decks.name)).all();
}

async function repoRoot(path: string): Promise<string> {
  const isDirectory = await stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw new Error(`No such directory: ${path}`);
  try {
    const { stdout } = await run("git", ["-C", path, "rev-parse", "--show-toplevel"]);
    return await realpath(stdout.trim());
  } catch {
    throw new Error(`Not a git repository: ${path}`);
  }
}

/** Top-level directories that aren't hidden or git-ignored, sorted. */
async function topLevelModules(root: string): Promise<string[]> {
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  const ignored = await gitIgnored(root, dirs);
  return dirs.filter((dir) => !ignored.has(dir)).sort();
}

async function gitIgnored(root: string, dirs: string[]): Promise<Set<string>> {
  if (dirs.length === 0) return new Set();
  const child = execFile("git", ["-C", root, "check-ignore", "--stdin"]);
  let stdout = "";
  child.stdout?.on("data", (chunk: string) => (stdout += chunk));
  child.stdin?.end(dirs.map((dir) => `${dir}/`).join("\n"));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  // check-ignore exits 1 when nothing is ignored.
  if (code !== 0 && code !== 1) throw new Error(`git check-ignore failed in ${root}`);
  return new Set(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/\/$/, "")),
  );
}

let ghCache: { at: number; list: string[] } | undefined;

/** The repos your gh login can see (cached a minute; none without gh or a login). */
export async function listGhRepos(): Promise<string[]> {
  if (ghCache && Date.now() - ghCache.at < 60_000) return ghCache.list;
  const args = [
    "repo",
    "list",
    "--limit",
    "100",
    "--json",
    "nameWithOwner",
    "--jq",
    ".[].nameWithOwner",
  ];
  const list = await run("gh", args, {
    timeout: 15_000,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  }).then(
    ({ stdout }) => stdout.split("\n").filter(Boolean),
    () => [],
  );
  ghCache = { at: Date.now(), list };
  return list;
}
