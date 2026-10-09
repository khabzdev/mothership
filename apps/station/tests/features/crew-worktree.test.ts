import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { branchName, createWorktree } from "../../src/features/crew/worktree.server.ts";

let scratch: string;
let repo: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-wt-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "hi");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "init",
  ]);
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("branchName", () => {
  test("slugs the goal and suffixes the mission id", () => {
    expect(branchName("Add a Dark-Mode toggle!", "1234567890ab")).toBe(
      "mothership/add-a-dark-mode-toggle-123456",
    );
  });

  test("caps the slug length and handles empty slugs", () => {
    expect(branchName("x".repeat(100), "abcdef99").length).toBeLessThanOrEqual(11 + 40 + 7);
    expect(branchName("!!!", "abcdef99")).toBe("mothership/mission-abcdef");
  });
});

describe("createWorktree", () => {
  test("creates a worktree on a new branch from HEAD", async () => {
    const path = join(scratch, "worktrees", "m1");
    const result = await createWorktree({ repoPath: repo, path, branch: "mothership/test-m1" });
    expect(result).toEqual({ path, branch: "mothership/test-m1" });
    expect(existsSync(join(path, "README.md"))).toBe(true);
    expect(execFileSync("git", ["-C", path, "branch", "--show-current"]).toString().trim()).toBe(
      "mothership/test-m1",
    );
  });

  test("reuses an existing worktree for the same branch", async () => {
    const path = join(scratch, "worktrees", "m1");
    await createWorktree({ repoPath: repo, path, branch: "mothership/test-m1" });
    await expect(
      createWorktree({ repoPath: repo, path, branch: "mothership/test-m1" }),
    ).resolves.toEqual({
      path,
      branch: "mothership/test-m1",
    });
  });

  test("fails clearly for a repo without commits", async () => {
    const empty = join(scratch, "empty");
    execFileSync("git", ["init", "-q", empty]);
    await expect(
      createWorktree({ repoPath: empty, path: join(scratch, "wt"), branch: "mothership/x" }),
    ).rejects.toThrow(/needs at least one commit/);
  });
});
