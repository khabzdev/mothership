import type { PreflightRecord } from "./preflight.server";

/** The guard's reason when the Inspector hasn't cleared the commit; a launch check compares against it. */
export const INSPECTOR_GUARD = "The Inspector hasn't cleared this commit. Launch anyway?";

/**
 * Why O should ask before opening a pull request, or null when it needn't: the deck's checks
 * aren't armed or the latest pre-flight was a GO on exactly what the worktree holds now, and the
 * Inspector (when on) has cleared exactly that too. The pre-flight reason comes first.
 */
export function launchGuard(
  latest: PreflightRecord | null,
  current: { hash: string },
  armed: boolean,
  inspection?: { on: boolean; latest: { state: string; fingerprint: string } | null },
): string | null {
  if (armed && !(latest?.state === "go" && latest.fingerprint === current.hash)) {
    return "No GO on record for this commit. Launch anyway?";
  }
  if (inspection?.on) {
    const seen = inspection.latest;
    if (!(seen?.state === "cleared" && seen.fingerprint === current.hash)) {
      return INSPECTOR_GUARD;
    }
  }
  return null;
}
