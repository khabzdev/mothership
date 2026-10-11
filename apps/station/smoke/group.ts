import type { Harness } from "./harness";
import type { SmokeRun } from "./results";

/** What every check group shares in one smoke run. */
export interface SmokeContext {
  run: SmokeRun;
  model: string;
  /** The station's launch path in temp folders; null when it could not start (see harnessError). */
  harness: Harness | null;
  harnessError: string;
  /** Installed versions in the form diagnostics reports them; written to smoke.json. */
  versions: { claude: string | null; gh: string | null };
  /** Set by claude.version: until then, claude checks skip instead of waiting out their timeouts. */
  claudeReady: boolean;
}

/**
 * A group of checks, run in order by smoke/real.smoke.ts. `ids` lists every check it records: any
 * it never reaches is written as failed "did not finish".
 */
export interface SmokeGroup {
  ids: string[];
  run(ctx: SmokeContext): Promise<void>;
}

/** The outcome for a claude check when claude.version did not pass. */
export const CLAUDE_UNAVAILABLE = { state: "skipped", detail: "claude unavailable" } as const;
