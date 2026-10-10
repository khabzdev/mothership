import type { InspectionInfo } from "@mothership/protocol";
import type { InspectionRecord } from "./inspection.server";

/** How serious a finding is: a blocker is handed back, a note is only shown. */
export type Severity = "blocker" | "note";

/** One thing the Inspector found, from the scope check or the AI review. */
export interface Finding {
  severity: Severity;
  source: "scope" | "review";
  file?: string;
  line?: number;
  title: string;
  why: string;
}

/** The most findings an inspection keeps. */
export const MAX_FINDINGS = 10;

/** The longest finding title, ellipsis included. */
export const TITLE_MAX = 80;

const asRecord = (input: unknown) =>
  (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

function requiredId(o: Record<string, unknown>, key: string): string {
  const value = typeof o[key] === "string" ? o[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

/** Inspecting a crew member by hand needs its id. */
export function parseCrewInspectInput(input: unknown): { crewId: string } {
  return { crewId: requiredId(asRecord(input), "crewId") };
}

/** Switching a deck's Inspector needs the deck and on or off. */
export function parseInspectorInput(input: unknown): { deckId: string; on: boolean } {
  const o = asRecord(input);
  if (typeof o.on !== "boolean") throw new Error("on must be true or false");
  return { deckId: requiredId(o, "deckId"), on: o.on };
}

/** `file:line`, `file` or nothing, for a finding's place. */
function place(f: Finding): string {
  if (!f.file) return "";
  return f.line ? `${f.file}:${f.line}` : f.file;
}

/** The message typed to the crew member when the Inspector flagged blockers. */
export function inspectionHandBack(
  blockers: Finding[],
  attempt: number,
  maxAttempts: number,
): string {
  const lines = blockers
    .filter((f) => f.severity === "blocker")
    .map((f) => {
      const at = place(f);
      return `✗ ${at ? `${at} ` : ""}${f.title} — ${f.why}`;
    });
  return [
    `Inspector flagged your change (attempt ${attempt} of ${maxAttempts}):`,
    ...lines,
    "Fix these, then stop. Pre-flight and the Inspector run again when you stop.",
  ].join("\n");
}

/** The alert text when the tank is empty and the Inspector still flags the change. */
export function flaggedDetail(findings: Finding[]): string {
  const first = findings.find((f) => f.severity === "blocker");
  return `Inspector flagged: ${first?.title ?? "see the findings"}`;
}

/** The inspection as a pull request section; blockers come before notes. */
export function prInspection(
  record: {
    state: "cleared" | "flagged";
    attempt: number;
    commit: string;
    findings: Finding[];
    fingerprint: string;
  },
  current?: { hash: string },
): string {
  const word = record.state === "cleared" ? "Cleared" : "Flagged";
  const lines = [
    `## Inspection: ${word}  (attempt ${record.attempt} · commit ${record.commit.slice(0, 7)})`,
  ];
  if (current && current.hash !== record.fingerprint) {
    lines.push("", "_Inspected an earlier state of this branch._");
  }
  const ordered = [
    ...record.findings.filter((f) => f.severity === "blocker"),
    ...record.findings.filter((f) => f.severity !== "blocker"),
  ];
  if (ordered.length) {
    lines.push("");
    for (const f of ordered) {
      const at = place(f);
      lines.push(`- ${f.severity} · ${at ? `${at} — ` : ""}${f.title}`);
    }
  }
  return lines.join("\n");
}

/** The chip on a crew row: nothing until an inspection has run this flight. */
export function inspectionChip(
  info?: InspectionInfo,
): { label: string; tone: "warning" | "success" | "error" } | null {
  if (!info) return null;
  if (info.state === "running") return { label: "Inspecting…", tone: "warning" };
  if (info.state === "cleared") return { label: "Cleared", tone: "success" };
  if (info.state === "flagged") return { label: "Flagged", tone: "error" };
  return null;
}

/** The toast when the Inspector couldn't run for a crew member: the spec's copy, then who and why. */
export function inspectionFailedToast(name: string, reason: string): string {
  return `Inspector couldn't run for ${name}: ${reason}`;
}

/** What the Inspection window shows from a crew member's history (newest first). */
export function windowSections(records: InspectionRecord[]): {
  current: InspectionRecord | null;
  blockers: Finding[];
  notes: Finding[];
  earlier: InspectionRecord[];
  outside: number;
  lines: number;
} {
  const [current = null, ...earlier] = records;
  const findings = current?.findings ?? [];
  const large = findings.find((f) => f.source === "scope" && f.title.startsWith("Large change:"));
  return {
    current,
    blockers: findings.filter((f) => f.severity === "blocker"),
    notes: findings.filter((f) => f.severity !== "blocker"),
    earlier,
    outside: findings.filter(
      (f) => f.source === "scope" && f.title.startsWith("Outside the brief:"),
    ).length,
    lines: Number(large?.title.match(/(\d+) lines/)?.[1] ?? 0),
  };
}
