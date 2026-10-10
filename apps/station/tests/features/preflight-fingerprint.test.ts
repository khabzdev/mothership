import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { fingerprint } from "../../src/features/preflight/fingerprint.server.ts";

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "mothership-fingerprint-")));
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "hi");
  writeFileSync(join(repo, ".gitignore"), "dist/\n");
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

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("fingerprint", () => {
  test("names HEAD and is stable while nothing changes", async () => {
    const a = await fingerprint(repo);
    expect(a.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await fingerprint(repo)).toEqual(a);
  });

  test("a tracked edit changes it", async () => {
    const before = await fingerprint(repo);
    writeFileSync(join(repo, "README.md"), "changed");
    expect((await fingerprint(repo)).hash).not.toBe(before.hash);
  });

  test("editing an untracked file again changes it", async () => {
    writeFileSync(join(repo, "new.ts"), "one");
    const before = await fingerprint(repo);
    writeFileSync(join(repo, "new.ts"), "two");
    expect((await fingerprint(repo)).hash).not.toBe(before.hash);
  });

  test("a second file inside a new untracked directory changes it", async () => {
    mkdirSync(join(repo, "feature"));
    writeFileSync(join(repo, "feature", "a.ts"), "a");
    const before = await fingerprint(repo);
    writeFileSync(join(repo, "feature", "b.ts"), "b");
    expect((await fingerprint(repo)).hash).not.toBe(before.hash);
  });

  test("ignored files don't count", async () => {
    const before = await fingerprint(repo);
    mkdirSync(join(repo, "dist"));
    writeFileSync(join(repo, "dist", "out.js"), "x");
    expect((await fingerprint(repo)).hash).toBe(before.hash);
  });
});
