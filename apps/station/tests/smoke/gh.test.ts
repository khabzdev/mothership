import { describe, expect, test } from "vite-plus/test";
import {
  assertReadOnly,
  branchPick,
  branchVerdict,
  firstOf,
  issuesVerdict,
  issueViewVerdict,
  pullsVerdict,
  pullViewVerdict,
} from "../../smoke/gh.ts";
import { toIssue, toPull } from "../../src/features/github/github.server.ts";

describe("assertReadOnly", () => {
  test.each([
    ["pr", "merge", "1"],
    ["pr", "create"],
    ["issue", "edit", "1"],
    ["issue", "comment", "1"],
    ["issue", "close", "1"],
    ["pr", "close", "1"],
    ["repo", "delete"],
    ["auth", "login"],
    ["api", "-X", "POST"],
    [],
  ])("refuses %j", (...args) => {
    expect(() => assertReadOnly(args)).toThrow(/read-only/);
  });

  test.each([
    ["pr", "list", "--repo", "a/b"],
    ["issue", "list"],
    ["issue", "view", "3"],
    ["pr", "view", "3"],
    ["--version"],
    ["auth", "status"],
  ])("allows %j", (...args) => {
    expect(() => assertReadOnly(args)).not.toThrow();
  });
});

const issue = (number: number, state = "OPEN") => ({
  number,
  state,
  url: `https://github.com/a/b/issues/${number}`,
  comments: [],
});
const pull = (number: number, state: string, extra: Record<string, unknown> = {}) => ({
  number,
  state,
  url: `https://github.com/a/b/pull/${number}`,
  ...extra,
});

describe("issuesVerdict", () => {
  test("passes with counts", () => {
    expect(issuesVerdict([issue(1)], [issue(2, "CLOSED")])).toEqual({
      state: "passed",
      detail: "1 open · 1 closed",
    });
  });
  test("skips when there is nothing to parse", () => {
    expect(issuesVerdict([], []).state).toBe("skipped");
  });
  test("fails on an item without a url", () => {
    expect(issuesVerdict([{ number: 4, state: "OPEN" }], []).state).toBe("failed");
  });
});

describe("pullsVerdict", () => {
  const merged = pull(2, "MERGED", { mergedAt: "2026-10-01T10:00:00Z" });
  test("passes when merged ones carry mergedAt", () => {
    expect(pullsVerdict([pull(1, "OPEN")], [merged], [pull(3, "CLOSED")]).state).toBe("passed");
  });
  test("fails when a merged one has no mergedAt", () => {
    const out = pullsVerdict([], [pull(2, "MERGED")], []);
    expect(out).toMatchObject({ state: "failed" });
    expect(out.detail).toContain("mergedAt");
  });
  test("fails on an unknown state", () => {
    expect(pullsVerdict([pull(1, "WEIRD")], [], []).state).toBe("failed");
  });
  test("skips when there is nothing to parse", () => {
    expect(pullsVerdict([], [], []).state).toBe("skipped");
  });
  test("fails on an item without a number or url", () => {
    expect(
      pullsVerdict([{ state: "OPEN", url: "https://github.com/a/b/pull/1" }], [], []).state,
    ).toBe("failed");
    expect(pullsVerdict([{ number: 1, state: "OPEN" }], [], []).state).toBe("failed");
  });
  test("says mergedAt went unverified without merged PRs, and still passes", () => {
    expect(pullsVerdict([pull(1, "OPEN")], [], [])).toEqual({
      state: "passed",
      detail: "1 open · 0 merged · 0 closed · mergedAt unverified: no merged PRs",
    });
  });
});

describe("firstOf", () => {
  test("the first item, parsed", () => {
    expect(firstOf([issue(3), issue(4)], toIssue, "issues")).toMatchObject({
      item: { number: 3 },
    });
    expect(firstOf([pull(5, "OPEN")], toPull, "pull requests")).toMatchObject({
      item: { number: 5, url: "https://github.com/a/b/pull/5" },
    });
  });
  test("skips an empty list", () => {
    expect(firstOf([], toIssue, "issues")).toEqual({
      outcome: { state: "skipped", detail: "no issues to view" },
    });
  });
  test("fails when the parse loses the number", () => {
    const out = firstOf([{ id: 3, state: "OPEN" }], toIssue, "issues");
    expect(out).toMatchObject({ outcome: { state: "failed" } });
  });
});

describe("branchPick", () => {
  test("the first open PR, parsed", () => {
    expect(branchPick([pull(9, "OPEN", { headRefName: "feat/x" })])).toMatchObject({
      item: { number: 9, headRefName: "feat/x", url: "https://github.com/a/b/pull/9" },
    });
  });
  test("skips without open PRs", () => {
    expect(branchPick([])).toEqual({
      outcome: { state: "skipped", detail: "no open pull requests" },
    });
  });
  test("fails when the parse loses the branch or url", () => {
    expect(branchPick([pull(9, "OPEN")])).toMatchObject({ outcome: { state: "failed" } });
    expect(branchPick([{ number: 9, state: "OPEN", headRefName: "feat/x" }])).toMatchObject({
      outcome: { state: "failed" },
    });
  });
});

describe("view verdicts", () => {
  test("issue view needs the number and a comments list", () => {
    expect(issueViewVerdict(issue(5), 5).state).toBe("passed");
    expect(issueViewVerdict(issue(5), 6).state).toBe("failed");
    expect(issueViewVerdict({ number: 5, url: "u" }, 5).state).toBe("failed");
  });
  test("pr view needs comments and reviews, and runs checksOf", () => {
    const view = pull(7, "OPEN", { comments: [], reviews: [], statusCheckRollup: [] });
    expect(pullViewVerdict(view, 7)).toMatchObject({ state: "passed" });
    expect(pullViewVerdict(view, 7).detail).toContain("checks none");
    expect(pullViewVerdict({ ...view, reviews: undefined }, 7).state).toBe("failed");
    expect(pullViewVerdict(view, 8).state).toBe("failed");
  });
});

describe("branchVerdict", () => {
  const picked = "https://github.com/a/b/pull/9";
  test("passes on the picked PR's url", () => {
    expect(branchVerdict(`${picked}\n`, "feat/x", picked).state).toBe("passed");
  });
  test("fails on empty or other output", () => {
    expect(branchVerdict("", "feat/x", picked).state).toBe("failed");
    expect(branchVerdict("nope", "feat/x", picked).state).toBe("failed");
  });
  test("fails on another PR's url", () => {
    const out = branchVerdict("https://github.com/a/b/pull/10\n", "feat/x", picked);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain(picked);
  });
});
