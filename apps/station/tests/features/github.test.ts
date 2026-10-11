import { describe, expect, test } from "vite-plus/test";
import {
  announceLaunch,
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

describe("merge reconcile", () => {
  const NOW = Date.parse("2026-10-11T12:00:00Z");
  const MIN = 60_000;
  const url = (n: number) => `https://github.com/o/r/pull/${n}`;
  const pr = (n: number, state: string, patch: object = {}) => ({
    number: n,
    title: `PR ${n}`,
    state,
    url: url(n),
    headRefName: `mission/${n}`,
    ...patch,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** A fake gh keyed by args: lists filter `pulls`, `pr view <url>` answers from `views`. */
  function fakeGh(state: { pulls: object[]; views?: Record<string, () => Promise<object>> }) {
    const viewed: string[] = [];
    const run: Gh = async (args) => {
      if (args[0] === "issue") return "[]";
      if (args[1] === "view") {
        viewed.push(args[2]!);
        expect(args.slice(3)).toEqual(["--json", "number,title,state,url,headRefName,mergedAt"]);
        const view = state.views?.[args[2]!];
        if (!view) throw new Error("no such pull request");
        return JSON.stringify(await view());
      }
      const wanted = args[3]!.toUpperCase();
      return JSON.stringify(
        state.pulls.filter(
          (p) =>
            (p as { state: string }).state === wanted ||
            (wanted === "CLOSED" && (p as { state: string }).state === "MERGED"),
        ),
      );
    };
    return { run, viewed };
  }

  function setup(
    state: { pulls: object[]; views?: Record<string, () => Promise<object>> },
    rows: { url: string; branch: string }[],
  ) {
    const gh = fakeGh(state);
    const boards = new GitHubBoards(gh.run, { unmerged: () => rows, now: () => NOW });
    const launches: Launch[] = [];
    boards.onLaunch((l) => launches.push(l));
    return { boards, launches, viewed: gh.viewed };
  }

  test("a mission PR merged an hour ago is credited on the first fetch, not recent", async () => {
    const mergedAt = new Date(NOW - 60 * MIN).toISOString();
    const { boards, launches, viewed } = setup({ pulls: [pr(7, "MERGED", { mergedAt })] }, [
      { url: url(7), branch: "mission/7" },
    ]);
    await boards.board("d", "/repo");
    await flush();
    expect(launches.map((l) => [l.pull.number, l.recent])).toEqual([[7, false]]);
    expect(viewed).toEqual([]);
  });

  test("merged two minutes ago is recent; matched by branch too", async () => {
    const mergedAt = new Date(NOW - 2 * MIN).toISOString();
    const { boards, launches } = setup({ pulls: [pr(7, "MERGED", { mergedAt })] }, [
      { url: "", branch: "mission/7" },
    ]);
    await boards.board("d", "/repo");
    await flush();
    expect(launches.map((l) => [l.pull.number, l.recent])).toEqual([[7, true]]);
  });

  test("an open mission PR is left alone", async () => {
    const { boards, launches, viewed } = setup({ pulls: [pr(7, "OPEN")] }, [
      { url: url(7), branch: "mission/7" },
    ]);
    await boards.board("d", "/repo");
    await flush();
    expect(launches).toEqual([]);
    expect(viewed).toEqual([]);
  });

  test("a mission PR in no list is looked up: merged sounds, closed doesn't", async () => {
    const mergedAt = new Date(NOW - 60 * MIN).toISOString();
    const { boards, launches, viewed } = setup(
      {
        pulls: [],
        views: {
          [url(7)]: async () => pr(7, "MERGED", { mergedAt }),
          [url(8)]: async () => pr(8, "CLOSED"),
        },
      },
      [
        { url: url(7), branch: "mission/7" },
        { url: url(8), branch: "mission/8" },
      ],
    );
    await boards.board("d", "/repo");
    await flush();
    expect(viewed).toEqual([url(7), url(8)]);
    expect(launches.map((l) => [l.pull.number, l.recent])).toEqual([[7, false]]);
  });

  test("a failed lookup is tried again on the next fetch", async () => {
    const { boards, launches, viewed } = setup({ pulls: [] }, [
      { url: url(7), branch: "mission/7" },
    ]);
    await boards.board("d", "/repo");
    await flush();
    await boards.board("d", "/repo", true);
    await flush();
    expect(viewed).toEqual([url(7), url(7)]);
    expect(launches).toEqual([]);
  });

  test("at most five lookups per fetch, the oldest first", async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ url: url(n), branch: `mission/${n}` }));
    const { boards, viewed } = setup({ pulls: [] }, rows);
    await boards.board("d", "/repo");
    await flush();
    expect(viewed).toEqual([1, 2, 3, 4, 5].map(url));
  });

  test("a merge seen as a transition is reported once, not again by the reconcile", async () => {
    const state = { pulls: [pr(7, "OPEN")] as object[] };
    const { boards, launches } = setup(state, [{ url: url(7), branch: "mission/7" }]);
    await boards.board("d", "/repo");
    await flush();
    state.pulls = [pr(7, "MERGED", { mergedAt: new Date(NOW - MIN).toISOString() })];
    await boards.board("d", "/repo", true);
    await flush();
    expect(launches.map((l) => [l.pull.number, l.recent])).toEqual([[7, true]]);
  });

  test("a transition without mergedAt counts as recent", async () => {
    const state = { pulls: [pr(9, "OPEN")] as object[] };
    const { boards, launches } = setup(state, []);
    await boards.board("d", "/repo");
    state.pulls = [pr(9, "MERGED")];
    await boards.board("d", "/repo", true);
    expect(launches.map((l) => [l.pull.number, l.recent])).toEqual([[9, true]]);
  });

  test("a lookup that never answers doesn't hold up the board", async () => {
    const { boards } = setup({ pulls: [], views: { [url(7)]: () => new Promise(() => {}) } }, [
      { url: url(7), branch: "mission/7" },
    ]);
    const board = await boards.board("d", "/repo");
    expect(board.error).toBeUndefined();
  });

  test("a board fetch error reconciles nothing", async () => {
    const run: Gh = async () => {
      throw new Error("boom");
    };
    let asked = 0;
    const boards = new GitHubBoards(run, {
      unmerged: () => {
        asked++;
        return [];
      },
      now: () => NOW,
    });
    expect((await boards.board("d", "/repo")).error).toBe("boom");
    await flush();
    expect(asked).toBe(0);
  });
});

describe("launch announcement", () => {
  const pull = toPull({
    number: 7,
    title: "Add toggle",
    state: "MERGED",
    url: "u",
    headRefName: "b",
    mergedAt: "2026-10-11T10:00:00Z",
  });

  function wire() {
    const sent: unknown[] = [];
    const credited: unknown[] = [];
    const announce = announceLaunch({
      roster: () => [{ id: "c1", prUrl: "u" }],
      broadcast: (msg) => sent.push(msg),
      onMerged: (deckId, p) => {
        credited.push([deckId, p]);
        return true;
      },
    });
    return { announce, sent, credited };
  }

  test("a catch-up merge credits the rank without the launch show", () => {
    const { announce, sent, credited } = wire();
    announce({ deckId: "d", pull, recent: false });
    expect(credited).toEqual([["d", { url: "u", branch: "b", mergedAt: pull.mergedAt }]]);
    expect(sent).toEqual([]);
  });

  test("a recent merge credits and plays the show from its console", () => {
    const { announce, sent, credited } = wire();
    announce({ deckId: "d", pull, recent: true });
    expect(credited).toHaveLength(1);
    expect(sent).toEqual([
      { type: "pr.merged", deckId: "d", number: 7, title: "Add toggle", crewId: "c1" },
    ]);
  });
});
