import type { PreflightRecord } from "./preflight.server";
import { plainLines } from "../search/model";

/** A check's output tail keeps at most this many lines… */
export const TAIL_LINES = 60;
/** …and at most this many bytes of UTF-8. */
export const TAIL_BYTES = 8192;

/** The end of a check's output as plain text: no colours, progress bars resolved. */
export function tailOf(output: string): string {
  const lines = plainLines(output);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  const text = lines.slice(-TAIL_LINES).join("\n");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= TAIL_BYTES) return text;
  // Cutting mid-character leaves U+FFFD at the start; drop it.
  return new TextDecoder().decode(bytes.subarray(-TAIL_BYTES)).replace(/^�+/, "");
}

export interface CheckFailure {
  name: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  timeoutMs: number;
  durationMs: number;
  tail: string;
}

function failureBlock(f: CheckFailure): string {
  const how = f.timedOut
    ? `timed out after ${Math.round(f.timeoutMs / 60_000)}m`
    : `exit ${f.exitCode ?? "?"}`;
  const header = `✗ ${f.name}  (\`${f.command}\`, ${how}, ${(f.durationMs / 1000).toFixed(1)}s)`;
  return f.tail ? `${header}\n${f.tail}` : header;
}

/** What the station types into a crew member's input box after a NO-GO. */
export function handBackMessage(
  failures: CheckFailure[],
  attempt: number,
  maxAttempts: number,
): string {
  return [
    `Pre-flight NO-GO (attempt ${attempt} of ${maxAttempts}). These checks failed in your worktree:`,
    failures.map(failureBlock).join("\n\n"),
    "Fix them, then stop. The station re-runs every check when you stop.",
  ].join("\n\n");
}

/** The "needs you" detail once a flight's fuel is spent. */
export function outOfFuelDetail(names: string[], attempts: number): string {
  return `Out of fuel: ${names.join(", ")} still NO-GO after ${attempts} attempts`;
}

const VERDICT_LABEL = { go: "GO", nogo: "NO-GO", skipped: "Skipped" } as const;

/**
 * A pre-flight as the pull request's evidence: a heading and one table row per check. Given what
 * the worktree holds now, evidence from an earlier state of the branch says so under its heading.
 */
export function prEvidence(record: PreflightRecord, current?: { hash: string }): string {
  const seconds = Math.round(((record.finishedAt ?? record.startedAt) - record.startedAt) / 1000);
  const mark = record.state === "go" ? "GO ✅" : "NO-GO ❌";
  const rows = record.results.map(
    (r) =>
      `| ${r.name.replace(/\|/g, "\\|")} | ${VERDICT_LABEL[r.verdict]} | ${(r.durationMs / 1000).toFixed(1)}s |`,
  );
  return [
    `### Pre-flight: ${mark}  (attempt ${record.attempt} · ${seconds}s · commit ${record.commit.slice(0, 7)})`,
    ...(current && current.hash !== record.fingerprint
      ? [
          `_Ran on an earlier state of this branch (commit ${record.commit.slice(0, 7)}); the branch has changed since._`,
        ]
      : []),
    "| Check | Verdict | Time |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}
