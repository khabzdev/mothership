import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checksOf,
  type BoardData,
  type GhIssue,
  type GhPull,
  type IssueDetail,
  type PullDetail,
} from "./model";

/** Runs gh in a folder and returns its stdout (swapped out in tests). */
export type Gh = (args: string[], cwd: string) => Promise<string>;

const run = promisify(execFile);
export const gh: Gh = async (args, cwd) =>
  (
    await run("gh", args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    })
  ).stdout;

const ISSUE_FIELDS = "number,title,state,url,author,labels,assignees,updatedAt,body,comments";
const PULL_FIELDS =
  "number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,baseRefName,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
type Raw = Record<string, unknown>;
const login = (v: unknown) => (v as { login?: string } | null)?.login ?? "";
const names = (v: unknown) =>
  Array.isArray(v) ? v.map((l: { name?: string; login?: string }) => l.name ?? l.login ?? "") : [];
const clip = (v: unknown) => str(v).slice(0, 4000);

function toIssue(i: Raw): GhIssue {
  return {
    number: Number(i.number),
    title: str(i.title),
    state: i.state === "CLOSED" ? "CLOSED" : "OPEN",
    url: str(i.url),
    author: login(i.author),
    labels: names(i.labels),
    assignees: names(i.assignees),
    updatedAt: str(i.updatedAt),
    body: clip(i.body),
    comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
  };
}

function toPull(p: Raw): GhPull {
  const state = (str(p.state) || "OPEN").toUpperCase();
  return {
    number: Number(p.number),
    title: str(p.title),
    state: state === "MERGED" ? "MERGED" : state === "CLOSED" ? "CLOSED" : "OPEN",
    isDraft: !!p.isDraft,
    url: str(p.url),
    author: login(p.author),
    labels: names(p.labels),
    reviewDecision: str(p.reviewDecision),
    headRefName: str(p.headRefName),
    baseRefName: str(p.baseRefName),
    updatedAt: str(p.updatedAt),
    additions: Number(p.additions ?? 0),
    deletions: Number(p.deletions ?? 0),
    checks: checksOf(p.statusCheckRollup),
    body: clip(p.body),
    closes: Array.isArray(p.closingIssuesReferences)
      ? (p.closingIssuesReferences as Raw[]).map((r) => Number(r.number)).filter((n) => n > 0)
      : [],
  };
}

/** How long a deck's boards are served from the cache before GitHub is asked again (ms). */
const FRESH_MS = 30_000;

/** A pull request that merged since the last look: the launch klaxon. */
export interface Launch {
  deckId: string;
  pull: GhPull;
}

/** Each deck's issues and pull requests, from gh, cached briefly and refreshed on demand. */
export class GitHubBoards {
  readonly #gh: Gh;
  readonly #cache = new Map<string, BoardData>();
  readonly #inflight = new Map<string, Promise<BoardData>>();
  readonly #launchListeners = new Set<(launch: Launch) => void>();

  constructor(ghRunner: Gh = gh) {
    this.#gh = ghRunner;
  }

  /** The deck's boards, from the cache while fresh (or `force` to ask GitHub now). */
  board(deckId: string, repoPath: string, force = false): Promise<BoardData> {
    const cached = this.#cache.get(deckId);
    if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS)
      return Promise.resolve(cached);
    let pending = this.#inflight.get(deckId);
    if (!pending) {
      pending = this.#fetch(deckId, repoPath).finally(() => this.#inflight.delete(deckId));
      this.#inflight.set(deckId, pending);
    }
    return pending;
  }

  /** Called with every pull request that merged between two looks at GitHub. */
  onLaunch(listener: (launch: Launch) => void): () => void {
    this.#launchListeners.add(listener);
    return () => this.#launchListeners.delete(listener);
  }

  /** Forget what was fetched, so the next look asks GitHub (after a merge, an assignment…). */
  invalidate(deckId: string): void {
    const cached = this.#cache.get(deckId);
    if (cached) this.#cache.set(deckId, { ...cached, fetchedAt: 0 });
  }

  /** One issue with its comments, for the issue window. */
  async issue(cwd: string, number: number): Promise<IssueDetail> {
    const i = JSON.parse(
      await this.#gh(["issue", "view", String(number), "--json", `${ISSUE_FIELDS}`], cwd),
    ) as Raw;
    const comments = Array.isArray(i.comments) ? (i.comments as Raw[]) : [];
    return {
      ...toIssue({ ...i, comments: comments.length }),
      thread: comments.map((c) => ({
        author: login(c.author),
        body: clip(c.body),
        createdAt: str(c.createdAt),
      })),
    };
  }

  /** One pull request with its checks and reviews, for the PR window. */
  async pull(cwd: string, number: number): Promise<PullDetail> {
    const p = JSON.parse(
      await this.#gh(
        ["pr", "view", String(number), "--json", `${PULL_FIELDS},comments,reviews`],
        cwd,
      ),
    ) as Raw;
    const list = (v: unknown) => (Array.isArray(v) ? (v as Raw[]) : []);
    return {
      ...toPull(p),
      checkRuns: list(p.statusCheckRollup).map((c) => ({
        name: str(c.name) || str(c.context) || "check",
        state: checksOf([c]),
      })),
      thread: [...list(p.reviews), ...list(p.comments)]
        .map((c) => ({
          author: login(c.author),
          body: clip(c.body),
          createdAt: str(c.submittedAt) || str(c.createdAt),
          ...(str(c.state) && { review: str(c.state) }),
        }))
        .filter((c) => c.body || c.review)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  /** Take an issue on: assigned to you, so it moves to In progress (agent-office's claim). */
  async claimIssue(cwd: string, number: number): Promise<void> {
    await this.#gh(["issue", "edit", String(number), "--add-assignee", "@me"], cwd);
  }

  async commentIssue(cwd: string, number: number, body: string): Promise<void> {
    await this.#gh(["issue", "comment", String(number), "--body", body], cwd);
  }

  async closeIssue(
    cwd: string,
    number: number,
    reason: "completed" | "not planned",
  ): Promise<void> {
    await this.#gh(["issue", "close", String(number), "--reason", reason], cwd);
  }

  async mergePull(
    cwd: string,
    number: number,
    method: "squash" | "merge" | "rebase",
  ): Promise<void> {
    await this.#gh(["pr", "merge", String(number), `--${method}`], cwd);
  }

  async closePull(cwd: string, number: number): Promise<void> {
    await this.#gh(["pr", "close", String(number)], cwd);
  }

  async #fetch(deckId: string, cwd: string): Promise<BoardData> {
    const before = this.#cache.get(deckId);
    try {
      const list = (args: string[]) => this.#gh(args, cwd).then((out) => JSON.parse(out) as Raw[]);
      const [open, closed, openPulls, merged, closedPulls] = await Promise.all([
        list(["issue", "list", "--state", "open", "--limit", "300", "--json", ISSUE_FIELDS]),
        list(["issue", "list", "--state", "closed", "--limit", "40", "--json", ISSUE_FIELDS]),
        list(["pr", "list", "--state", "open", "--limit", "150", "--json", PULL_FIELDS]),
        list(["pr", "list", "--state", "merged", "--limit", "30", "--json", PULL_FIELDS]),
        list(["pr", "list", "--state", "closed", "--limit", "40", "--json", PULL_FIELDS]),
      ]);
      // `--state closed` includes merged ones: keep each PR once.
      const seen = new Set<number>();
      const pulls = [...openPulls, ...merged, ...closedPulls]
        .map(toPull)
        .filter((p) => !seen.has(p.number) && seen.add(p.number));
      const board: BoardData = {
        issues: [...open, ...closed].map(toIssue),
        pulls,
        fetchedAt: Date.now(),
      };
      this.#cache.set(deckId, board);
      if (before && !before.error) {
        for (const p of pulls) {
          const was = before.pulls.find((b) => b.number === p.number);
          if (was?.state === "OPEN" && p.state === "MERGED") {
            for (const listener of this.#launchListeners) listener({ deckId, pull: p });
          }
        }
      }
      return board;
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { stderr?: string };
      const reason =
        e.code === "ENOENT"
          ? "Install the GitHub CLI (gh) and run gh auth login to see the boards"
          : e.stderr?.trim().split("\n").at(-1) || e.message;
      const board: BoardData = {
        issues: before?.issues ?? [],
        pulls: before?.pulls ?? [],
        error: reason,
        fetchedAt: Date.now(),
      };
      this.#cache.set(deckId, board);
      return board;
    }
  }
}
