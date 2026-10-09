import { describe, expect, test } from "vite-plus/test";
import { moduleForPath, resolveWaypoint, sameWaypoint, type CrewSignal } from "../src/index.ts";

const deck = { root: "/work/repo", modules: ["src", "tests", "docs"] };

function resolve(signal: CrewSignal) {
  return resolveWaypoint(signal, deck);
}

describe("moduleForPath", () => {
  test("maps a path to its top-level directory module", () => {
    expect(moduleForPath("src/billing/invoice.ts", deck.modules)).toBe("src");
  });

  test("root-level files belong to the hub", () => {
    expect(moduleForPath("package.json", deck.modules)).toBeNull();
  });

  test("unknown top-level directories belong to the hub", () => {
    expect(moduleForPath("scripts/release.sh", deck.modules)).toBeNull();
  });
});

describe("resolveWaypoint: status", () => {
  test("red alert runs to the bridge rail, whatever the activity", () => {
    expect(
      resolve({
        status: "needs_input",
        activity: { tool: "Edit", filePath: "/work/repo/src/a.ts" },
      }),
    ).toEqual({ kind: "bridgeRail" });
  });

  test.each(["starting", "idle", "done", "asleep"] as const)("%s returns to quarters", (status) => {
    expect(resolve({ status })).toEqual({ kind: "quarters" });
  });

  test("working with no activity yet stays put", () => {
    expect(resolve({ status: "working" })).toBeNull();
  });
});

describe("resolveWaypoint: file tools", () => {
  test.each(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"])(
    "%s walks to the file's module console",
    (tool) => {
      expect(
        resolve({ status: "working", activity: { tool, filePath: "/work/repo/tests/a.test.ts" } }),
      ).toEqual({ kind: "module", moduleId: "tests" });
    },
  );

  test("accepts paths relative to the deck root", () => {
    expect(
      resolve({ status: "working", activity: { tool: "Read", filePath: "docs/x.md" } }),
    ).toEqual({ kind: "module", moduleId: "docs" });
  });

  test("root-level files go to the hub", () => {
    expect(
      resolve({
        status: "working",
        activity: { tool: "Edit", filePath: "/work/repo/package.json" },
      }),
    ).toEqual({ kind: "hub" });
  });

  test("files outside the deck are ignored", () => {
    expect(
      resolve({ status: "working", activity: { tool: "Read", filePath: "/etc/hosts" } }),
    ).toBeNull();
  });

  test("a sibling directory sharing the root prefix is outside the deck", () => {
    expect(
      resolve({
        status: "working",
        activity: { tool: "Read", filePath: "/work/repo-other/src/a.ts" },
      }),
    ).toBeNull();
  });

  test("path traversal out of the deck is ignored", () => {
    expect(
      resolve({
        status: "working",
        activity: { tool: "Read", filePath: "/work/repo/../secret/a" },
      }),
    ).toBeNull();
  });

  test("search tools with a path walk to that module", () => {
    expect(
      resolve({ status: "working", activity: { tool: "Grep", filePath: "/work/repo/src" } }),
    ).toEqual({ kind: "module", moduleId: "src" });
  });

  test("file tools without a path stay put", () => {
    expect(resolve({ status: "working", activity: { tool: "Glob" } })).toBeNull();
  });
});

describe("resolveWaypoint: Bash", () => {
  test.each([
    "vp test",
    "pnpm test --run",
    "npx vitest",
    "pytest -q",
    "go test ./...",
    "cargo test",
  ])("test command %j goes to the Go/No-Go console", (command) => {
    expect(resolve({ status: "working", activity: { tool: "Bash", command } })).toEqual({
      kind: "preflightConsole",
    });
  });

  test.each(["git status", "pnpm install", "ls -la", "vp dev", "cat latest.txt"])(
    "other command %j goes to the engineering bay",
    (command) => {
      expect(resolve({ status: "working", activity: { tool: "Bash", command } })).toEqual({
        kind: "engineeringBay",
      });
    },
  );
});

describe("resolveWaypoint: other tools", () => {
  test.each(["WebFetch", "TodoWrite", "Task", "mcp__x__y"])("%s stays put", (tool) => {
    expect(resolve({ status: "working", activity: { tool } })).toBeNull();
  });
});

describe("sameWaypoint", () => {
  test("compares kind and module", () => {
    expect(sameWaypoint({ kind: "hub" }, { kind: "hub" })).toBe(true);
    expect(sameWaypoint({ kind: "module", moduleId: "a" }, { kind: "module", moduleId: "a" })).toBe(
      true,
    );
    expect(sameWaypoint({ kind: "module", moduleId: "a" }, { kind: "module", moduleId: "b" })).toBe(
      false,
    );
    expect(sameWaypoint({ kind: "hub" }, { kind: "airlock" })).toBe(false);
  });
});
