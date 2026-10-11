import type { SmokeStatus } from "./smoke";

export type CheckId = "git" | "claude" | "ptyhost" | "gh";
export type CheckStatus = "ok" | "missing" | "unauthenticated" | "error";

export interface Check {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail?: string;
  /** The installed version, when known (claude only), for comparing with the smoke run. */
  version?: string;
  fix?: string;
}

export interface Diagnostics {
  checks: Check[];
  /** Crew can launch: git, claude (signed in) and the PTY host are all ok. */
  crewReady: boolean;
  /** Missions can open PRs: git and gh (signed in) are ok. */
  launchReady: boolean;
  /** When the real-claude smoke last ran and whether it still applies. */
  smoke: SmokeStatus;
  checkedAt: number;
}

const CREW_CHECKS: CheckId[] = ["git", "claude", "ptyhost"];

/** Why crew can't launch (first failing crew check and its fix), or null if they can. */
export function crewBlocker(diagnostics: Diagnostics): string | null {
  const failing = diagnostics.checks.find((c) => CREW_CHECKS.includes(c.id) && c.status !== "ok");
  if (!failing) return null;
  return `Crew offline: ${failing.label}${failing.detail ? ` ${failing.detail}` : ""}${failing.fix ? `. ${failing.fix}` : ""}`;
}
