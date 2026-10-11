import { describe, expect, test } from "vite-plus/test";
import {
  GitHubBoards,
  PULL_FIELDS,
  toPull,
  type Gh,
  type Launch,
} from "../../src/features/github/github.server.ts";
import {
  checksOf,
  issueColumn,
  issuePrompt,
  pullColumn,
  type GhIssue,
  type GhPull,
} from "../../src/features/github/model.ts";

const issue = (patch: Partial<GhIssue> = {}): GhIssue => ({
  number: 1,
  title: "Fix login",
  state: "OPEN",
  url: "https://github.com/o/r/issues/1",
  author: "ada",
  labels: [],
  assignees: [],
  updatedAt: "",
  body: "",
  comments: 0,
  ...patch,
});

describe("board columns", () => {
  test("issues are in progress once assigned or labelled so", () => {
    expect(issueColumn(issue())).toBe("open");
    expect(issueColumn(issue({ assignees: ["ada"] }))).toBe("progress");
    expect(issueColumn(issue({ labels: ["In progress"] }))).toBe("progress");
    expect(issueColumn(issue({ state: "CLOSED", assignees: ["ada"] }))).toBe("closed");
  });

  test("pull requests by draft, review and state", () => {
    const pull = (patch: Partial<GhPull>) =>
      ({ state: "OPEN", isDraft: false, reviewDecision: "", ...patch }) as GhPull;
    expect(pullColumn(pull({ isDraft: true }))).toBe("draft");
    expect(pullColumn(pull({}))).toBe("review");
    expect(pullColumn(pull({ reviewDecision: "APPROVED" }))).toBe("approved");
    expect(pullColumn(pull({ state: "MERGED" }))).toBe("merged");
    expect(pullColumn(pull({ state: "CLOSED" }))).toBe("closed");
  });

  test("CI: failing beats pending beats passing", () => {
    expect(checksOf([])).toBe("none");
    expect(checksOf([{ conclusion: "SUCCESS", status: "COMPLETED" }])).toBe("pass");
    expect(checksOf([{ status: "IN_PROGRESS" }, { conclusion: "SUCCESS" }])).toBe("pending");
    expect(checksOf([{ status: "IN_PROGRESS" }, { conclusion: "FAILURE" }])).toBe("fail");
  });

  test("a crew member handed an issue is told what closes it", () => {
    expect(issuePrompt(issue({ body: "It 500s." }))).toContain('"Closes #1"');
  });
});

describe("merge time", () => {
  test("gh's mergedAt becomes epoch ms; empty or missing is absent", () => {
    expect(PULL_FIELDS.split(",")).toContain("mergedAt");
    expect(toPull({ mergedAt: "2026-10-11T10:00:00Z" }).mergedAt).toBe(
      Date.parse("2026-10-11T10:00:00Z"),
    );
    expect(toPull({ mergedAt: "" }).mergedAt).toBeUndefined();
    expect(toPull({}).mergedAt).toBeUndefined();
  });
});

describe("GitHubBoards", () => {
  function fakeGh(state: { pulls: object[]; fail?: boolean }) {
    let calls = 0;
    const run: Gh = async (args) => {
      calls++;
      if (state.fail) throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
      if (args[0] === "issue")
        return JSON.stringify(
          args[3] === "open"
            ? [
                {
                  number: 1,
                  title: "Bug",
                  state: "OPEN",
                  assignees: [{ login: "ada" }],
                  labels: [{ name: "bug" }],
                },
              ]
            : [],
        );
      const wanted = args[3]!.toUpperCase();
      return JSON.stringify(
        state.pulls.filter(
          (p) =>
            (p as { state: string }).state === wanted ||
            (wanted === "CLOSED" && (p as { state: string }).state === "MERGED"),
        ),
      );
    };
    return { run, calls: () => calls };
  }

  test("reads issues and PRs, each PR once, and serves them from the cache", async () => {
    const state = { pulls: [{ number: 7, title: "Add toggle", state: "MERGED" }] };
    const { run, calls } = fakeGh(state);
    const boards = new GitHubBoards(run);
    const board = await boards.board("d", "/repo");
    expect(board.issues[0]).toMatchObject({ number: 1, assignees: ["ada"], labels: ["bug"] });
    expect(board.pulls.map((p) => p.number)).toEqual([7]);
    const asked = calls();
    await boards.board("d", "/repo");
    expect(calls()).toBe(asked);
  });

  test("a PR that merged since the last look sounds the launch", async () => {
    const state = { pulls: [{ number: 7, title: "Add toggle", state: "OPEN" }] };
    const boards = new GitHubBoards(fakeGh(state).run);
    const launches: Launch[] = [];
    boards.onLaunch((l) => launches.push(l));
    await boards.board("d", "/repo");
    state.pulls = [{ number: 7, title: "Add toggle", state: "MERGED" }];
    await boards.board("d", "/repo", true);
    expect(launches.map((l) => [l.deckId, l.pull.number])).toEqual([["d", 7]]);
  });

  test("without gh the board says how to get it", async () => {
    const boards = new GitHubBoards(fakeGh({ pulls: [], fail: true }).run);
    expect((await boards.board("d", "/repo")).error).toContain("Install the GitHub CLI");
  });
});
