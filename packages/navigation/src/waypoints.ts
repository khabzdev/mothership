import type { CrewActivity, CrewStatus } from "@spaceship/protocol";

export type Waypoint =
  | { kind: "module"; moduleId: string }
  | { kind: "hub" }
  | { kind: "engineeringBay" }
  | { kind: "preflightConsole" }
  | { kind: "bridgeRail" }
  | { kind: "quarters" }
  | { kind: "airlock" };

export interface CrewSignal {
  status: CrewStatus;
  activity?: CrewActivity;
}

export interface DeckRef {
  /** Absolute path of the crew member's worktree. */
  root: string;
  /** Module ids: the deck's top-level directory names. */
  modules: readonly string[];
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"]);

const TEST_COMMAND =
  /(^|[\s;&|/])(vp test|vitest|jest|pytest|go test|cargo test|(pnpm|npm|yarn|bun)( run)? test)\b/;

/**
 * Where should the crew member be, given what they are doing?
 * Returns null when the signal doesn't say anything about location (stay put).
 */
export function resolveWaypoint(signal: CrewSignal, deck: DeckRef): Waypoint | null {
  if (signal.status === "needs_input") return { kind: "bridgeRail" };
  if (signal.status !== "working") return { kind: "quarters" };

  const { activity } = signal;
  if (!activity) return null;

  if (activity.tool === "Bash") {
    return activity.command && TEST_COMMAND.test(activity.command)
      ? { kind: "preflightConsole" }
      : { kind: "engineeringBay" };
  }

  if (FILE_TOOLS.has(activity.tool) && activity.filePath) {
    const relative = relativeToRoot(activity.filePath, deck.root);
    if (relative === null) return null;
    const moduleId = moduleForPath(relative, deck.modules);
    return moduleId ? { kind: "module", moduleId } : { kind: "hub" };
  }

  return null;
}

/** The module a deck-relative path belongs to, or null for the hub. */
export function moduleForPath(relativePath: string, modules: readonly string[]): string | null {
  const [first] = relativePath.split("/");
  return first && modules.includes(first) ? first : null;
}

export function sameWaypoint(a: Waypoint, b: Waypoint): boolean {
  if (a.kind === "module" && b.kind === "module") return a.moduleId === b.moduleId;
  return a.kind === b.kind;
}

/** Deck-relative POSIX path, or null if the path escapes the root. */
function relativeToRoot(filePath: string, root: string): string | null {
  const absolute = filePath.startsWith("/") ? filePath : `${root}/${filePath}`;
  const normalized = normalize(absolute);
  const base = normalize(root);
  if (normalized === null || base === null) return null;
  if (normalized === base) return "";
  return normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : null;
}

function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}
