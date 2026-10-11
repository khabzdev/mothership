import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkGh } from "../src/app/diagnostics.server";
import { exec } from "../src/app/exec.server";
import {
  ISSUE_FIELDS,
  PULL_FIELDS,
  PULL_VIEW_FIELDS,
  toIssue,
  toPull,
} from "../src/features/github/github.server";
import { checksOf } from "../src/features/github/model";
import { openPrForBranchArgs } from "../src/features/pr/pr.server";
import type { SmokeContext, SmokeGroup } from "./group";
import { runCheck, type Outcome, type SmokeRun } from "./results";

type Raw = Record<string, unknown>;

const SKIP_NO_REPO: Outcome = { state: "skipped", detail: "set SMOKE_GH_REPO=owner/name" };
const STATES = ["OPEN", "MERGED", "CLOSED"];
const LIMIT = "20";

const passed = (detail: string): Outcome => ({ state: "passed", detail });
const failed = (detail: string): Outcome => ({ state: "failed", detail });
const skipped = (detail: string): Outcome => ({ state: "skipped", detail });

/** The smoke only ever reads from GitHub: the one gate every gh invocation passes through. */
export function assertReadOnly(args: string[]): void {
  const [first, second] = args;
  const ok =
    first === "--version" ||
    (first === "auth" && second === "status") ||
    ((first === "issue" || first === "pr") && (second === "list" || second === "view"));
  if (!ok) throw new Error(`smoke gh is read-only: refusing "gh ${args.slice(0, 2).join(" ")}"`);
}

const run = promisify(execFile);

/** Runs gh (read-only subcommands only) against the smoke repo and returns its stdout. */
async function gh(repo: string, args: string[]): Promise<string> {
  const full = [...args, "--repo", repo];
  assertReadOnly(full);
  try {
    return (
      await run("gh", full, {
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      })
    ).stdout;
  } catch (error) {
    const e = error as Error & { stderr?: string };
    throw new Error(e.stderr?.trim().split("\n").at(-1) || e.message);
  }
}

const list = async (repo: string, args: string[]) => JSON.parse(await gh(repo, args)) as Raw[];
const first = (items: Raw[]) => Number(items[0]?.number);

/** gh.issues: the open and closed lists, every item through `toIssue`. */
export function issuesVerdict(open: Raw[], closed: Raw[]): Outcome {
  const issues = [...open, ...closed].map(toIssue);
  if (!issues.length) return skipped("no issues in the repo to parse");
  const bad = issues.find((i) => !(i.number > 0) || !i.url);
  if (bad) return failed(`issue #${bad.number} parsed without a number or url`);
  return passed(`${open.length} open · ${closed.length} closed`);
}

/** gh.pulls: open, merged and closed lists through `toPull`; merged ones carry `mergedAt`. */
export function pullsVerdict(open: Raw[], merged: Raw[], closed: Raw[]): Outcome {
  const pulls = [...open, ...merged, ...closed].map(toPull);
  if (!pulls.length) return skipped("no pull requests in the repo to parse");
  const raw = [...open, ...merged, ...closed];
  const badState = raw.findIndex((p) => !STATES.includes(String(p.state).toUpperCase()));
  if (badState >= 0)
    return failed(`PR #${pulls[badState]!.number} has state ${String(raw[badState]!.state)}`);
  const noStamp = merged.map(toPull).find((p) => p.state !== "MERGED" || p.mergedAt === undefined);
  if (noStamp) return failed(`merged PR #${noStamp.number} has no mergedAt`);
  return passed(`${open.length} open · ${merged.length} merged · ${closed.length} closed`);
}

/** gh.issue-view: the detail carries its comments as a list. */
export function issueViewVerdict(view: Raw, number: number): Outcome {
  const issue = toIssue(view);
  if (issue.number !== number) return failed(`asked for #${number}, got #${issue.number}`);
  if (!Array.isArray(view.comments)) return failed("no comments list");
  return passed(`#${number} ${issue.state} · ${view.comments.length} comments`);
}

/** gh.pr-view: the detail carries comments and reviews, and its checks resolve. */
export function pullViewVerdict(view: Raw, number: number): Outcome {
  const pull = toPull(view);
  if (pull.number !== number) return failed(`asked for #${number}, got #${pull.number}`);
  if (!Array.isArray(view.comments) || !Array.isArray(view.reviews)) {
    return failed("no comments or reviews list");
  }
  const checks = checksOf(view.statusCheckRollup);
  return passed(
    `#${number} ${pull.state} · ${view.comments.length} comments · ${view.reviews.length} reviews · checks ${checks}`,
  );
}

/** gh.pr-branch: the open-PR-for-branch query prints the PR's url. */
export function branchVerdict(output: string, branch: string): Outcome {
  const url = output.trim();
  if (!/^https?:\/\/\S+\/pull\/\d+$/.test(url)) return failed(`no pull request url for ${branch}`);
  return passed(`${branch} → ${url}`);
}

async function version(ctx: SmokeContext): Promise<Outcome> {
  // The station's own diagnostics, with every gh call checked read-only on the way through.
  const check = await checkGh({
    exec: (command, args, timeoutMs) => {
      if (command === "gh") assertReadOnly(args);
      return exec(command, args, timeoutMs);
    },
  });
  const detail = check.detail ?? check.status;
  ctx.versions.gh = check.status === "ok" ? detail.split(" · ")[0]! : null;
  ctx.run.evidence("gh.version", "diagnostics.txt", `${check.status}: ${detail}\n`);
  if (check.status !== "ok") return failed(check.fix ? `${detail} · ${check.fix}` : detail);
  return passed(detail);
}

async function checkAll(run: SmokeRun, repo: string): Promise<void> {
  // The lists gh.issues and gh.pulls fetched: the view checks pick their first item from them.
  let issues: Raw[][] = [];
  let pulls: Raw[][] = [];

  await runCheck(run, "gh.issues", async () => {
    issues = await Promise.all(
      ["open", "closed"].map((state) =>
        list(repo, ["issue", "list", "--state", state, "--limit", LIMIT, "--json", ISSUE_FIELDS]),
      ),
    );
    return issuesVerdict(issues[0]!, issues[1]!);
  });

  await runCheck(run, "gh.pulls", async () => {
    pulls = await Promise.all(
      ["open", "merged", "closed"].map((state) =>
        list(repo, ["pr", "list", "--state", state, "--limit", LIMIT, "--json", PULL_FIELDS]),
      ),
    );
    return pullsVerdict(pulls[0]!, pulls[1]!, pulls[2]!);
  });

  await runCheck(run, "gh.issue-view", async () => {
    const number = first(issues.flat());
    if (!(number > 0)) return skipped("no issues to view");
    const view = JSON.parse(
      await gh(repo, ["issue", "view", String(number), "--json", ISSUE_FIELDS]),
    ) as Raw;
    return issueViewVerdict(view, number);
  });

  await runCheck(run, "gh.pr-view", async () => {
    const number = first(pulls.flat());
    if (!(number > 0)) return skipped("no pull requests to view");
    const view = JSON.parse(
      await gh(repo, ["pr", "view", String(number), "--json", PULL_VIEW_FIELDS]),
    ) as Raw;
    return pullViewVerdict(view, number);
  });

  await runCheck(run, "gh.pr-branch", async () => {
    const open = pulls[0]?.[0];
    const branch = open ? toPull(open).headRefName : "";
    if (!branch) return skipped("no open pull requests");
    return branchVerdict(await gh(repo, openPrForBranchArgs(branch)), branch);
  });
}

const IDS = ["gh.version", "gh.issues", "gh.pulls", "gh.issue-view", "gh.pr-view", "gh.pr-branch"];

/** gh.version … gh.pr-branch: the station's gh calls against $SMOKE_GH_REPO, read-only. */
export const ghChecks: SmokeGroup = {
  ids: IDS,
  async run(ctx) {
    const repo = process.env.SMOKE_GH_REPO?.trim();
    if (!repo) {
      for (const id of IDS) await runCheck(ctx.run, id, async () => SKIP_NO_REPO);
      return;
    }
    const versionCheck = await runCheck(ctx.run, "gh.version", () => version(ctx));
    if (versionCheck.state !== "passed") {
      for (const id of IDS.slice(1)) {
        await runCheck(ctx.run, id, async () => skipped("gh unavailable"));
      }
      return;
    }
    await checkAll(ctx.run, repo);
  },
};
