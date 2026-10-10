import type { PreflightRecord } from "./preflight.server";

/**
 * Why O should ask before opening a pull request, or null when it needn't: the deck's checks
 * aren't armed, or the latest pre-flight was a GO on exactly what the worktree holds now.
 */
export function launchGuard(
  latest: PreflightRecord | null,
  current: { hash: string },
  armed: boolean,
): string | null {
  if (!armed) return null;
  if (latest?.state === "go" && latest.fingerprint === current.hash) return null;
  return "No GO on record for this commit. Launch anyway?";
}
