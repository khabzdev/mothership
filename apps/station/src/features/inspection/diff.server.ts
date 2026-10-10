import { readChanges, readDiff } from "../changes/git.server";
import { DIFF_CAP_BYTES } from "./review";
import type { ChangedStat } from "./scope";

/**
 * What the Inspector looks at in a checkout: every changed file with its line counts, and their
 * diffs, against the same base as the Changes window (`homeRef`), untracked files included.
 * Diffs stop being read once there's more than the review prompt keeps.
 */
export async function readInspectionDiff(
  cwd: string,
  homeRef: string | null,
): Promise<{ files: ChangedStat[]; diff: string }> {
  const changes = await readChanges(cwd, homeRef);
  const files = changes.files.map(({ path, additions, deletions }) => ({
    path,
    additions,
    deletions,
  }));
  let diff = "";
  for (const file of changes.files) {
    if (Buffer.byteLength(diff) > DIFF_CAP_BYTES) break;
    diff += (await readDiff(cwd, homeRef, file)).diff;
  }
  return { files, diff };
}
