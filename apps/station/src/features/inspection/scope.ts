import type { Finding } from "./model";

/** A changed file with its added and removed line counts. */
export interface ChangedStat {
  path: string;
  additions: number;
  deletions: number;
}

/** Added plus removed lines above this earn a "Large change" note. */
export const DIFF_BUDGET = 400;

/** This many files outside the brief make a blocker. */
export const OUTSIDE_BLOCKER = 3;

/** Lockfiles never count as outside the brief or towards the budget. */
export const IGNORED_FILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock*"];

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.\w+$/;
const MENTIONS_TESTS = /test|spec/i;

// Any line that starts a section: `# X`, `**X**`, or `X:` on its own.
const HEADING_LINES = [
  /^\s*#{1,6}\s*\S/,
  /^\s*\*\*[^*]+\*\*\s*:?\s*$/,
  /^\s*[A-Za-z][A-Za-z ]{0,30}:\s*$/,
];

function isHeading(line: string): boolean {
  return HEADING_LINES.some((re) => re.test(line));
}

// Each pattern matches a heading line for `name`; group 1 is any text on that same line.
function namedHeading(line: string, name: string): string | null {
  const patterns = [
    new RegExp(`^\\s*#{1,6}\\s*${name}\\b\\s*:?\\s*(.*)$`, "i"),
    new RegExp(`^\\s*\\*\\*${name}\\*\\*\\s*:?\\s*(.*)$`, "i"),
    new RegExp(`^\\s*${name}\\s*:\\s*(.*)$`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

/** The lines under a brief heading up to the next heading; "" when the heading is absent. */
export function briefSection(text: string, heading: "Files" | "Proof"): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => namedHeading(line, heading) !== null);
  if (at === -1) return "";
  const out: string[] = [];
  const same = namedHeading(lines[at]!, heading);
  if (same) out.push(same);
  for (let i = at + 1; i < lines.length; i++) {
    if (isHeading(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n").trim();
}

const looksLikePath = (token: string) => token.includes("/") || token.includes(".");

/** The paths and directories in a brief's Files section. */
export function briefPaths(text: string): string[] {
  const paths: string[] = [];
  for (const line of briefSection(text, "Files").split("\n")) {
    const ticked = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
    if (ticked.length) {
      paths.push(...ticked.filter(Boolean));
    } else if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
      const tokens = line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .split(/\s+/)
        .map((t) => t.replace(/[,;:.]+$/, ""))
        .filter((t) => t && looksLikePath(t));
      paths.push(...tokens);
    }
  }
  return paths;
}

function isIgnored(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return IGNORED_FILES.some((p) =>
    p.endsWith("*") ? base.startsWith(p.slice(0, -1)) : base === p,
  );
}

function covered(path: string, listed: string[]): boolean {
  return listed.some((p) => {
    const bare = p.replace(/^\.\//, "");
    if (bare.endsWith("/")) return path.startsWith(bare);
    return path === bare || path.startsWith(`${bare}/`);
  });
}

/** Findings for a change measured against its approved brief; none without a brief. */
export function scopeCheck(files: ChangedStat[], brief: string | null): Finding[] {
  if (brief === null) return [];
  const counted = files.filter((f) => !isIgnored(f.path));
  const findings: Finding[] = [];

  const listed = briefPaths(brief);
  const outside = counted.filter((f) => !covered(f.path, listed));
  for (const f of outside) {
    findings.push({
      severity: "note",
      source: "scope",
      file: f.path,
      title: `Outside the brief: ${f.path}`,
      why: "The brief's Files section doesn't list this file.",
    });
  }
  if (outside.length >= OUTSIDE_BLOCKER) {
    findings.push({
      severity: "blocker",
      source: "scope",
      title: `Changed ${outside.length} files the brief didn't list`,
      why: "The change has wandered outside the approved plan; stick to the brief's Files or ask for a revision.",
    });
  }

  const lines = counted.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  if (lines > DIFF_BUDGET) {
    findings.push({
      severity: "note",
      source: "scope",
      title: `Large change: ${lines} lines`,
      why: `More than ${DIFF_BUDGET} lines added and removed.`,
    });
  }

  if (
    MENTIONS_TESTS.test(briefSection(brief, "Proof")) &&
    !files.some((f) => TEST_FILE.test(f.path))
  ) {
    findings.push({
      severity: "note",
      source: "scope",
      title: "Brief promised tests; none changed",
      why: "The brief's Proof mentions tests, but no test file was changed.",
    });
  }
  return findings;
}
