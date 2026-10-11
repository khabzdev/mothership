// What the deck's boards show from GitHub (agent-office's GhIssue and GhPull).

export interface GhIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
  author: string;
  labels: string[];
  assignees: string[];
  updatedAt: string;
  body: string;
  comments: number;
}

export type ChecksState = "none" | "pending" | "pass" | "fail";

export interface GhPull {
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  url: string;
  author: string;
  labels: string[];
  reviewDecision: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  /** When it merged (ms), if gh said. */
  mergedAt?: number;
  additions: number;
  deletions: number;
  checks: ChecksState;
  body: string;
  /** Issues it closes when it merges. */
  closes: number[];
}

export interface BoardData {
  issues: GhIssue[];
  pulls: GhPull[];
  /** Why GitHub couldn't be asked (no gh, not signed in, no GitHub remote). */
  error?: string;
  fetchedAt: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** A comment or review in an issue's or PR's thread. */
export interface ThreadEntry {
  author: string;
  body: string;
  createdAt: string;
  /** For a review: APPROVED, CHANGES_REQUESTED, COMMENTED. */
  review?: string;
}

export interface IssueDetail extends GhIssue {
  thread: ThreadEntry[];
}

export interface PullDetail extends GhPull {
  checkRuns: { name: string; state: ChecksState }[];
  thread: ThreadEntry[];
}

export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** { deckId, number }, and whatever else an action takes. */
export function parseItemInput(input: unknown): { deckId: string; number: number } {
  const deckId = isObject(input) && typeof input.deckId === "string" ? input.deckId : "";
  const number = isObject(input) ? input.number : undefined;
  if (!deckId) throw new Error("deckId is required");
  if (!Number.isInteger(number) || (number as number) < 1) throw new Error("number is required");
  return { deckId, number: number as number };
}

export function parseMergeInput(input: unknown): {
  deckId: string;
  number: number;
  method: MergeMethod;
} {
  const method = isObject(input) ? input.method : undefined;
  return {
    ...parseItemInput(input),
    method: MERGE_METHODS.includes(method as MergeMethod) ? (method as MergeMethod) : "squash",
  };
}

export function parseCommentInput(input: unknown): {
  deckId: string;
  number: number;
  body: string;
} {
  const body = isObject(input) && typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new Error("Write a comment first");
  return { ...parseItemInput(input), body };
}

export function parseCloseIssueInput(input: unknown): {
  deckId: string;
  number: number;
  reason: "completed" | "not planned";
} {
  const reason = isObject(input) && input.reason === "not planned" ? "not planned" : "completed";
  return { ...parseItemInput(input), reason };
}

export function parseHandInput(input: unknown): {
  deckId: string;
  number: number;
  consoleId?: number;
} {
  const consoleId = isObject(input) ? input.consoleId : undefined;
  return {
    ...parseItemInput(input),
    ...(Number.isInteger(consoleId) && { consoleId: consoleId as number }),
  };
}

export type IssueColumn = "open" | "progress" | "closed";
export type PullColumn = "draft" | "review" | "approved" | "merged" | "closed";

const IN_PROGRESS = /^(in[ -]?progress|doing|wip)$/i;

/** The Mission board's column: in progress once it's assigned or labelled so (agent-office). */
export function issueColumn(issue: GhIssue): IssueColumn {
  if (issue.state === "CLOSED") return "closed";
  if (issue.assignees.length || issue.labels.some((l) => IN_PROGRESS.test(l))) return "progress";
  return "open";
}

/** The Launch board's column. */
export function pullColumn(pull: GhPull): PullColumn {
  if (pull.state === "MERGED") return "merged";
  if (pull.state === "CLOSED") return "closed";
  if (pull.isDraft) return "draft";
  return pull.reviewDecision === "APPROVED" ? "approved" : "review";
}

/** CI across a PR's check runs and statuses (agent-office's checksOf). */
export function checksOf(rollup: unknown): ChecksState {
  if (!Array.isArray(rollup) || !rollup.length) return "none";
  let pending = false;
  for (const c of rollup as Record<string, unknown>[]) {
    const concl = (str(c.conclusion) || str(c.state)).toUpperCase();
    const status = str(c.status).toUpperCase();
    if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(concl))
      return "fail";
    if (status && status !== "COMPLETED") pending = true;
    if (concl === "PENDING" || concl === "EXPECTED") pending = true;
  }
  return pending ? "pending" : "pass";
}

/** What a crew member is told when handed an issue (agent-office's issue prompt, shortened). */
export function issuePrompt(issue: Pick<GhIssue, "number" | "title" | "body" | "url">): string {
  return [
    `Work on GitHub issue #${issue.number}: ${issue.title}`,
    issue.url,
    issue.body.trim() && `\n${issue.body.trim()}`,
    `\nWhen it's done, commit your work. A pull request for it should say "Closes #${issue.number}".`,
  ]
    .filter(Boolean)
    .join("\n");
}
