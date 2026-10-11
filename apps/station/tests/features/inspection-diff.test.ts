import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { readInspectionDiff } from "../../src/features/inspection/diff.server.ts";

let scratch: string;
let repo: string;
let tree: string;
let home: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    encoding: "utf8",
  });

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "spaceship-inspection-diff-")));
  repo = join(scratch, "shop");
  tree = join(scratch, "tree");
  execFileSync("git", ["init", "-q", repo]);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  home = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "worktree", "add", "-q", "-b", "spaceship/x", tree);
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("readInspectionDiff", () => {
  test("a huge lockfile is listed but kept out of the review diff", async () => {
    const lock = Array.from({ length: 5000 }, (_, i) => `  pkg-${i}: 1.0.${i}`).join("\n");
    writeFileSync(join(tree, "pnpm-lock.yaml"), `${lock}\n`);
    git(tree, "add", "pnpm-lock.yaml");
    git(tree, "commit", "-qm", "lock");
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");

    const { files, diff } = await readInspectionDiff(tree, home);
    expect(files.map((f) => f.path)).toEqual(["pnpm-lock.yaml", "src/a.ts"]);
    expect(diff).toContain("+export const a = 2;");
    expect(diff).not.toContain("pkg-0");
  });

  test("diffs committed and untracked changes against the deck's head", async () => {
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 3;\n");
    git(tree, "commit", "-qam", "change");
    writeFileSync(join(tree, "src", "b.ts"), "export const b = 1;\n");

    const { files, diff } = await readInspectionDiff(tree, home);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(diff).toContain("+export const a = 3;");
    expect(diff).toContain("+export const b = 1;");
  });
});
