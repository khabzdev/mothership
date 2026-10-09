import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { dockRepo, listDecks } from "../../src/features/decks/decks.server.ts";
import { parseDockRepoInput } from "../../src/features/decks/model.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let db: Db;
let scratch: string;

function makeRepo(name: string, dirs: string[], gitignore = ""): string {
  const repo = join(scratch, name);
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const dir of dirs) mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, "package.json"), "{}");
  if (gitignore) writeFileSync(join(repo, ".gitignore"), gitignore);
  return repo;
}

beforeEach(() => {
  db = createDb(":memory:", { migrationsFolder });
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-decks-")));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("dockRepo", () => {
  test("docks a git repo with its visible, non-ignored top-level directories as modules", async () => {
    const repo = makeRepo(
      "shop",
      ["src", "tests", "docs", ".github", "node_modules/x", "dist", "coverage"],
      "node_modules\n/dist\ncoverage/\n",
    );
    const deck = await dockRepo(db, repo);
    expect(deck).toMatchObject({ name: "shop", repoPath: repo, modules: ["docs", "src", "tests"] });
    expect(deck.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("docking a subdirectory docks the repo root", async () => {
    const repo = makeRepo("app", ["src/lib"]);
    const deck = await dockRepo(db, join(repo, "src", "lib"));
    expect(deck.repoPath).toBe(repo);
  });

  test("re-docking refreshes modules and keeps the same deck", async () => {
    const repo = makeRepo("app", ["src"]);
    const first = await dockRepo(db, repo);
    mkdirSync(join(repo, "scripts"));
    const second = await dockRepo(db, repo);
    expect(second.id).toBe(first.id);
    expect(second.modules).toEqual(["scripts", "src"]);
    expect(await listDecks(db)).toHaveLength(1);
  });

  test("rejects a directory that is not a git repo", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    await expect(dockRepo(db, plain)).rejects.toThrow(`Not a git repository: ${plain}`);
  });

  test("rejects a path that does not exist", async () => {
    const missing = join(scratch, "missing");
    await expect(dockRepo(db, missing)).rejects.toThrow(`No such directory: ${missing}`);
  });

  test("rejects a file", async () => {
    const repo = makeRepo("app", []);
    await expect(dockRepo(db, join(repo, "package.json"))).rejects.toThrow("No such directory");
  });
});

describe("listDecks", () => {
  test("lists docked decks by name", async () => {
    await dockRepo(db, makeRepo("zeta", ["src"]));
    await dockRepo(db, makeRepo("alpha", ["lib"]));
    expect((await listDecks(db)).map((d) => d.name)).toEqual(["alpha", "zeta"]);
  });

  test("is empty before anything is docked", async () => {
    expect(await listDecks(db)).toEqual([]);
  });
});

describe("parseDockRepoInput", () => {
  test("accepts an absolute path and trims it", () => {
    expect(parseDockRepoInput({ repoPath: "  /work/repo " })).toEqual({ repoPath: "/work/repo" });
  });

  test.each([
    ["a non-object", "nope", "Expected { repoPath }"],
    ["a missing path", {}, "repoPath must be a string"],
    ["an empty path", { repoPath: "  " }, "repoPath must be an absolute path"],
    ["a relative path", { repoPath: "work/repo" }, "repoPath must be an absolute path"],
    ["a path with a NUL byte", { repoPath: "/work/\0repo" }, "repoPath must not contain NUL"],
  ])("rejects %s", (_, input, message) => {
    expect(() => parseDockRepoInput(input)).toThrow(message);
  });
});
