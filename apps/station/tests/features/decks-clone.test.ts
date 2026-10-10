import type { CloneInfo, ServerMsg } from "@mothership/protocol";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { CloneManager, cloneTarget, readProgress } from "../../src/features/decks/clone.server.ts";
import type { Deck } from "../../src/features/decks/model.ts";

describe("what to clone", () => {
  test("owner/name goes through gh, into <owner>/<name>", () => {
    expect(cloneTarget("acme/shop")).toEqual({
      tool: "gh",
      source: "acme/shop",
      owner: "acme",
      name: "shop",
    });
    expect(cloneTarget("acme/shop.git").name).toBe("shop");
  });

  test("URLs go through git, named from their path", () => {
    expect(cloneTarget("https://github.com/acme/shop.git")).toMatchObject({
      tool: "git",
      owner: "acme",
      name: "shop",
    });
    expect(cloneTarget("git@github.com:acme/shop.git")).toMatchObject({
      owner: "acme",
      name: "shop",
    });
    expect(cloneTarget("file:///srv/git/shop.git")).toMatchObject({ owner: "git", name: "shop" });
  });

  test("anything else is refused", () => {
    expect(() => cloneTarget("not a repo")).toThrow("owner/name");
    expect(() => cloneTarget("-upload-pack=evil")).toThrow();
  });
});

describe("readProgress", () => {
  test("reads git's progress lines", () => {
    expect(readProgress("Receiving objects:  64% (640/1000), 231.00 MiB | 1.50 MiB/s")).toBe(
      "Downloading 64% · 231.00 MiB · 1.50 MiB/s",
    );
    expect(readProgress("remote: Counting objects:  12% (1/8)")).toBe("Counting 12%");
    expect(readProgress("Resolving deltas: 100% (3/3), done.")).toBe("Unpacking 100%");
    expect(readProgress("Cloning into 'shop'...")).toBeNull();
  });
});

describe("CloneManager", () => {
  let scratch: string;
  let origin: string;
  let sent: CloneInfo[][];
  let docked: string[];
  let clones: CloneManager;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-clone-")));
    const src = join(scratch, "src");
    execFileSync("git", ["init", "-q", src]);
    writeFileSync(join(src, "README.md"), "hi");
    execFileSync("git", ["-C", src, "add", "."]);
    execFileSync("git", [
      "-C",
      src,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "init",
    ]);
    origin = join(scratch, "shop.git");
    execFileSync("git", ["clone", "-q", "--bare", src, origin]);
    sent = [];
    docked = [];
    clones = new CloneManager({
      workspace: join(scratch, "ws"),
      broadcast: (msg: ServerMsg) =>
        msg.type === "deck.clones" && sent.push(structuredClone(msg.clones)),
      dock: async (path) => {
        docked.push(path);
        return {
          id: "deck-9",
          name: "shop",
          repoPath: path,
          modules: [],
          queueLimit: 3,
          checksArmed: null,
          createdAt: new Date(),
        } as Deck;
      },
    });
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  const settled = () =>
    new Promise<CloneInfo>((resolve) => {
      const check = () => {
        const c = clones.list()[0];
        if (c && c.state !== "cloning") resolve(c);
        else setTimeout(check, 25);
      };
      check();
    });

  test("clones into the workspace and docks it as a deck", async () => {
    clones.start(`file://${origin}`);
    expect(sent[0]?.[0]).toMatchObject({ state: "cloning", name: "shop" });
    const done = await settled();
    expect(done).toMatchObject({ state: "done", deckId: "deck-9" });
    expect(docked).toEqual([join(scratch, "ws", scratch.split("/").at(-1)!, "shop")]);
    expect(existsSync(join(docked[0]!, "README.md"))).toBe(true);
    expect(sent.at(-1)?.[0]?.state).toBe("done");
  });

  test("a failed clone says why and leaves nothing behind", async () => {
    clones.start(`file://${join(scratch, "missing.git")}`);
    const failed = await settled();
    expect(failed.state).toBe("failed");
    expect(failed.error).toBeTruthy();
    expect(docked).toEqual([]);
  });

  test("cancelling forgets it", async () => {
    const info = clones.start(`file://${origin}`);
    clones.cancel(info.id);
    expect(clones.list()).toEqual([]);
  });
});
