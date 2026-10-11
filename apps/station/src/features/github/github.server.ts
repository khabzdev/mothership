import type { ServerMsg } from "@spaceship/protocol";
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

export const ISSUE_FIELDS =
  "number,title,state,url,author,labels,assignees,updatedAt,body,comments";
export const PULL_FIELDS =
  "number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,baseRefName,updatedAt,mergedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences";

/** The fields a PR window asks `pr view` for: the list fields plus the thread. */
export const PULL_VIEW_FIELDS = `${PULL_FIELDS},comments,reviews`;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
type Raw = Record<string, unknown>;
const login = (v: unknown) => (v as { login?: string } | null)?.login ?? "";
const names = (v: unknown) =>
  Array.isArray(v) ? v.map((l: { name?: string; login?: string }) => l.name ?? l.login ?? "") : [];
const clip = (v: unknown) => str(v).slice(0, 4000);

export function toIssue(i: Raw): GhIssue {
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

export function toPull(p: Raw): GhPull {
  const state = (str(p.state) || "OPEN").toUpperCase();
  const mergedAt = Date.parse(str(p.mergedAt)) || undefined;
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
    ...(mergedAt && { mergedAt }),
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

/** A merge newer than this plays the launch show; older ones are only credited (ms). */
const RECENT_MS = 10 * 60_000;
/** At most this many mission PRs missing from the lists are looked up per fetch. */
const RECONCILE_LOOKUPS = 5;
const VIEW_FIELDS = "number,title,state,url,headRefName,mergedAt";

/** A pull request that merged since the last look: the launch klaxon (`recent`), or a catch-up. */
export interface Launch {
  deckId: string;
  pull: GhPull;
  recent: boolean;
}

interface Options {
  /** The deck's mission PRs not yet credited as merged, oldest first. */
  unmerged?: (deckId: string, now: number) => { url: string; branch: string }[];
  /** A mission PR seen closed without merging, so it stops being looked up. */
  closed?: (deckId: string, url: string) => void;
  now?: () => number;
}

/** The station's launch listener: always credits the merge, plays the show only when recent. */
export function announceLaunch(deps: {
  roster: (deckId: string) => { id: string; prUrl?: string | null; branch?: string | null }[];
  broadcast: (msg: ServerMsg) => void;
  onMerged: (deckId: string, pull: { url: string; branch: string; mergedAt?: number }) => boolean;
}): (launch: Launch) => void {
  return ({ deckId, pull, recent }) => {
    if (recent) {
      // Over the console it came from, if we know it.
      const from = deps
        .roster(deckId)
        .find((c) => c.prUrl === pull.url || (!!c.branch && c.branch === pull.headRefName));
      deps.broadcast({
        type: "pr.merged",
        deckId,
        number: pull.number,
        title: pull.title,
        ...(from && { crewId: from.id }),
      });
    }
    deps.onMerged(deckId, {
      url: pull.url,
      branch: pull.headRefName,
      ...(pull.mergedAt !== undefined && { mergedAt: pull.mergedAt }),
    });
  };
}

/** Each deck's issues and pull requests, from gh, cached briefly and refreshed on demand. */
export class GitHubBoards {
  readonly #gh: Gh;
  readonly #cache = new Map<string, BoardData>();
  readonly #inflight = new Map<string, Promise<BoardData>>();
  readonly #launchListeners = new Set<(launch: Launch) => void>();
  readonly #unmerged: NonNullable<Options["unmerged"]>;
  readonly #closed: NonNullable<Options["closed"]>;
  readonly #now: () => number;
  /** Decks with a reconcile still looking things up (one at a time, so a merge is told once). */
  readonly #reconciling = new Set<string>();

  constructor(ghRunner: Gh = gh, options: Options = {}) {
    this.#gh = ghRunner;
    this.#unmerged = options.unmerged ?? (() => []);
    this.#closed = options.closed ?? (() => {});
    this.#now = options.now ?? Date.now;
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

  /** Called with every pull request that merged between two looks at GitHub, and each missed
   *  mission PR merge the reconcile finds. */
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
      await this.#gh(["pr", "view", String(number), "--json", PULL_VIEW_FIELDS], cwd),
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
      const reported = new Set<number>();
      if (before && !before.error) {
        const now = this.#now();
        for (const p of pulls) {
          const was = before.pulls.find((b) => b.number === p.number);
          if (was?.state === "OPEN" && p.state === "MERGED") {
            reported.add(p.number);
            this.#merged(deckId, p, p.mergedAt === undefined || now - p.mergedAt <= RECENT_MS);
          }
        }
      }
      void this.#reconcile(deckId, cwd, board, reported);
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

  /** The one place a merge is told to the launch listeners. A listener that throws can neither
   *  turn the board fetch into an error board nor stop the reconcile's remaining lookups. */
  #merged(deckId: string, pull: GhPull, recent: boolean): void {
    for (const listener of this.#launchListeners) {
      try {
        listener({ deckId, pull, recent });
      } catch (error) {
        console.warn("[github] launch listener failed:", error);
      }
    }
  }

  /** Mission PRs that merged without a transition being seen (between polls, or while the
   *  station was down): matched in the fetched lists, else looked up, a few per fetch. */
  async #reconcile(
    deckId: string,
    cwd: string,
    board: BoardData,
    reported: Set<number>,
  ): Promise<void> {
    if (this.#reconciling.has(deckId)) return;
    this.#reconciling.add(deckId);
    try {
      const now = this.#now();
      const merge = (pull: GhPull) => {
        if (reported.has(pull.number)) return;
        reported.add(pull.number);
        this.#merged(deckId, pull, pull.mergedAt !== undefined && now - pull.mergedAt <= RECENT_MS);
      };
      const missing: string[] = [];
      for (const row of this.#unmerged(deckId, now)) {
        const pull =
          board.pulls.find((p) => !!row.url && p.url === row.url) ??
          board.pulls.find((p) => !!row.branch && p.headRefName === row.branch);
        if (pull?.state === "MERGED") merge(pull);
        else if (pull?.state === "CLOSED") this.#closed(deckId, row.url || pull.url);
        else if (!pull && row.url) missing.push(row.url);
      }
      for (const url of missing.slice(0, RECONCILE_LOOKUPS)) {
        let pull: GhPull;
        try {
          pull = toPull(
            JSON.parse(await this.#gh(["pr", "view", url, "--json", VIEW_FIELDS], cwd)) as Raw,
          );
        } catch {
          continue; // Not found, offline, signed out: tried again on a later fetch.
        }
        if (pull.state === "MERGED") merge(pull);
        else if (pull.state === "CLOSED") this.#closed(deckId, url);
      }
    } catch (error) {
      console.warn("[github] reconcile failed:", error);
    } finally {
      this.#reconciling.delete(deckId);
    }
  }
}
