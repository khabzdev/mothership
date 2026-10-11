/** The smoke suite writes its result here, in $MOTHERSHIP_HOME. */
export const SMOKE_FILE = "smoke.json";

export type SmokeCheckState = "passed" | "failed" | "skipped";

export interface SmokeCheck {
  id: string;
  state: SmokeCheckState;
  detail: string;
}

export interface SmokeFile {
  ranAt: number;
  claudeVersion: string | null;
  ghVersion: string | null;
  model: string;
  checks: SmokeCheck[];
}

export interface SmokeStatus {
  state: "passed" | "failed" | "stale" | "none";
  line: string;
  failed: SmokeCheck[];
  checks: SmokeCheck[];
  ranAt?: number;
}

const STATES: readonly string[] = ["passed", "failed", "skipped"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown) => value === null || typeof value === "string";

/** The smoke result, or null for anything that isn't exactly the shape the suite writes. */
export function parseSmokeFile(text: string): SmokeFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { ranAt, claudeVersion, ghVersion, model, checks } = raw;
  if (typeof ranAt !== "number" || !Number.isFinite(ranAt)) return null;
  if (!stringOrNull(claudeVersion) || !stringOrNull(ghVersion)) return null;
  if (typeof model !== "string" || !Array.isArray(checks)) return null;
  const parsed: SmokeCheck[] = [];
  for (const check of checks) {
    if (!isRecord(check)) return null;
    const { id, state, detail } = check;
    if (typeof id !== "string" || typeof detail !== "string") return null;
    if (typeof state !== "string" || !STATES.includes(state)) return null;
    parsed.push({ id, state: state as SmokeCheckState, detail });
  }
  return {
    ranAt,
    claudeVersion: claudeVersion as string | null,
    ghVersion: ghVersion as string | null,
    model,
    checks: parsed,
  };
}

/** "just now", "5m", "3h", "2d". */
function age(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** What the station says about the last real-claude smoke run. */
export function smokeStatus(
  file: SmokeFile | null,
  claudeVersion: string | null,
  now: number,
): SmokeStatus {
  if (!file) return { state: "none", line: "No smoke run yet", failed: [], checks: [] };
  const { checks, ranAt } = file;
  const failed = checks.filter((c) => c.state === "failed");
  if (failed.length) {
    const n = failed.length;
    return {
      state: "failed",
      line: `Smoke failed: ${n} ${n === 1 ? "check" : "checks"}`,
      failed,
      checks,
      ranAt,
    };
  }
  if (claudeVersion && file.claudeVersion && claudeVersion !== file.claudeVersion) {
    return {
      state: "stale",
      line: `Claude Code changed since smoke (${file.claudeVersion} → ${claudeVersion})`,
      failed,
      checks,
      ranAt,
    };
  }
  const when = age(now - ranAt);
  const version = file.claudeVersion ?? claudeVersion ?? "unknown";
  return {
    state: "passed",
    line: `Smoke passed ${when === "just now" ? when : `${when} ago`} · Claude Code ${version}`,
    failed,
    checks,
    ranAt,
  };
}

export const NO_SMOKE: SmokeStatus = smokeStatus(null, null, 0);
