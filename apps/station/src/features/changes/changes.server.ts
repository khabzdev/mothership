import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { getStation } from "../../app/station.server";
import { commitAll, discardAll, discardFile, readChanges, readDiff } from "./git.server";
import type { ChangedFile } from "./model";

const run = promisify(execFile);

/** A crew member's checkout and what its changes are measured against. */
async function checkout(crewId: string): Promise<{ cwd: string; homeRef: string | null }> {
  const { cwd, repoPath, ownWorktree } = getStation().crew.workdir(crewId);
  if (!existsSync(cwd)) throw new Error("Its worktree is gone");
  if (!ownWorktree) return { cwd, homeRef: null };
  const { stdout } = await run("git", ["-C", repoPath, "rev-parse", "HEAD"]);
  return { cwd, homeRef: stdout.trim() };
}

export async function changesOf(crewId: string) {
  const { cwd, homeRef } = await checkout(crewId);
  return readChanges(cwd, homeRef);
}

/** Only files the window lists can be read or discarded: no paths from outside the checkout. */
async function listed(
  crewId: string,
  path: string,
): Promise<{ cwd: string; homeRef: string | null; file: ChangedFile }> {
  const { cwd, homeRef } = await checkout(crewId);
  const file = (await readChanges(cwd, homeRef)).files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} has no changes`);
  return { cwd, homeRef, file };
}

export async function diffOf(crewId: string, path: string) {
  const { cwd, homeRef, file } = await listed(crewId, path);
  return readDiff(cwd, homeRef, file);
}

export async function commitChanges(crewId: string, message: string) {
  const { cwd } = await checkout(crewId);
  await commitAll(cwd, message);
}

export async function discardChanges(crewId: string, path?: string) {
  if (path) {
    const { cwd, file } = await listed(crewId, path);
    return discardFile(cwd, file);
  }
  return discardAll((await checkout(crewId)).cwd);
}
