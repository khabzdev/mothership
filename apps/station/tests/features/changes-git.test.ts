import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  commitAll,
  discardAll,
  discardFile,
  readChanges,
  readDiff,
} from "../../src/features/changes/git.server.ts";

let scratch: string;
let repo: string;
let tree: string;
let home: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    encoding: "utf8",
  });

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-changes-")));
  repo = join(scratch, "shop");
  tree = join(scratch, "tree");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  writeFileSync(join(repo, "b.txt"), "bee\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  home = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "worktree", "add", "-q", "-b", "mothership/x", tree);
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("readChanges", () => {
  test("a fresh worktree has nothing changed", async () => {
    expect(await readChanges(tree, home)).toEqual({
      branch: "mothership/x",
      base: home,
      ahead: 0,
      files: [],
      more: 0,
    });
  });

  test("lists committed and uncommitted changes since it branched, and new files", async () => {
    writeFileSync(join(tree, "a.txt"), "one\nTWO\nthree\n");
    git(tree, "commit", "-qam", "Edit a");
    writeFileSync(join(tree, "b.txt"), "");
    writeFileSync(join(tree, "c.txt"), "new\n");
    const state = await readChanges(tree, home);
    expect(state).toMatchObject({ ahead: 1, subject: "Edit a" });
    expect(state.files).toEqual([
      expect.objectContaining({
        path: "a.txt",
        status: "M",
        additions: 2,
        deletions: 1,
        uncommitted: false,
      }),
      expect.objectContaining({ path: "b.txt", status: "M", deletions: 1, uncommitted: true }),
      expect.objectContaining({ path: "c.txt", status: "?", additions: 1, uncommitted: true }),
    ]);
  });

  test("in the deck's own checkout, only what isn't committed", async () => {
    writeFileSync(join(repo, "a.txt"), "changed\n");
    const state = await readChanges(repo, null);
    expect(state.base).toBe("HEAD");
    expect(state.files.map((f) => f.path)).toEqual(["a.txt"]);
  });
});

describe("readDiff", () => {
  test("diffs a changed file and a new one", async () => {
    writeFileSync(join(tree, "a.txt"), "one\nTWO\n");
    writeFileSync(join(tree, "c.txt"), "new\n");
    const { files } = await readChanges(tree, home);
    const a = await readDiff(tree, home, files[0]!);
    expect(a.diff).toContain("-two");
    expect(a.diff).toContain("+TWO");
    expect((await readDiff(tree, home, files[1]!)).diff).toContain("+new");
  });
});

describe("commit and discard", () => {
  test("commits everything", async () => {
    writeFileSync(join(tree, "c.txt"), "new\n");
    await commitAll(tree, "Add c");
    const state = await readChanges(tree, home);
    expect(state).toMatchObject({ ahead: 1, subject: "Add c" });
    expect(state.files[0]).toMatchObject({ path: "c.txt", status: "A", uncommitted: false });
  });

  test("discards one file, or everything uncommitted", async () => {
    writeFileSync(join(tree, "a.txt"), "changed\n");
    writeFileSync(join(tree, "b.txt"), "changed\n");
    writeFileSync(join(tree, "c.txt"), "new\n");
    const { files } = await readChanges(tree, home);
    await discardFile(
      tree,
      files.find((f) => f.path === "a.txt")!,
    );
    await discardFile(
      tree,
      files.find((f) => f.path === "c.txt")!,
    );
    expect(readFileSync(join(tree, "a.txt"), "utf8")).toBe("one\ntwo\n");
    expect(existsSync(join(tree, "c.txt"))).toBe(false);
    await discardAll(tree);
    expect((await readChanges(tree, home)).files).toEqual([]);
  });
});
