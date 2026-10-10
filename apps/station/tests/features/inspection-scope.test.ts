import { describe, expect, test } from "vite-plus/test";
import {
  briefPaths,
  briefSection,
  scopeCheck,
  type ChangedStat,
} from "../../src/features/inspection/scope.ts";

const stat = (path: string, additions = 1, deletions = 0): ChangedStat => ({
  path,
  additions,
  deletions,
});

describe("briefSection", () => {
  test("reads Files under each heading style and stops at the next heading", () => {
    const styles = [
      "## Goal\nx\n## Files\n- a.ts\n- b.ts\n## Proof\nt",
      "**Goal**\nx\n**Files**\n- a.ts\n- b.ts\n**Proof**\nt",
      "Goal: x\nFiles:\n- a.ts\n- b.ts\nProof:\nt",
    ];
    for (const text of styles) {
      expect(briefSection(text, "Files")).toBe("- a.ts\n- b.ts");
    }
  });

  test("a bold note between paths doesn't end the section", () => {
    const text = "## Files\n- src/a.ts\n**Note:** keep the old API\n- src/b.ts\n## Proof\nrun it";
    expect(briefPaths(text)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("a brief heading in any style still ends the section", () => {
    const styles = [
      "## Proof",
      "**Proof**",
      "**Proof:** run it",
      "**Proof**: run it",
      "Proof: run it",
    ];
    for (const proof of styles) {
      expect(briefSection(`## Files\n- src/a.ts\n${proof}\n- src/b.ts`, "Files")).toBe(
        "- src/a.ts",
      );
    }
    expect(briefSection("**Files**\n- src/a.ts\n### Notes\n- src/b.ts", "Files")).toBe(
      "- src/a.ts",
    );
  });

  test("is empty when the heading is missing", () => {
    expect(briefSection("## Goal\nx", "Files")).toBe("");
  });
});

describe("briefPaths", () => {
  test("collects backticked and list-item paths", () => {
    const text = "## Files\n- `src/auth/`\n- src/api.ts\n## Proof\nnone";
    expect(briefPaths(text)).toEqual(["src/auth/", "src/api.ts"]);
  });
});

const brief = "## Goal\nx\n## Files\n- `src/auth/`\n- src/api.ts\n## Proof\nrun the app\n";

describe("scopeCheck", () => {
  test("no brief, no findings", () => {
    expect(scopeCheck([stat("a.ts"), stat("b.ts"), stat("c.ts")], null)).toEqual([]);
  });

  test("listed files and files under a listed directory are fine", () => {
    expect(scopeCheck([stat("src/auth/login.ts"), stat("src/api.ts")], brief)).toEqual([]);
  });

  test("two outside files are notes; three add a blocker", () => {
    const two = scopeCheck([stat("x.ts"), stat("y.ts")], brief);
    expect(two.map((f) => [f.severity, f.title])).toEqual([
      ["note", "Outside the brief: x.ts"],
      ["note", "Outside the brief: y.ts"],
    ]);
    const three = scopeCheck([stat("x.ts"), stat("y.ts"), stat("z.ts")], brief);
    expect(three.filter((f) => f.severity === "note")).toHaveLength(3);
    expect(three.filter((f) => f.severity === "blocker").map((f) => f.title)).toEqual([
      "Changed 3 files the brief didn't list",
    ]);
    expect(three.every((f) => f.source === "scope")).toBe(true);
  });

  test("lockfiles are ignored", () => {
    expect(scopeCheck([stat("pnpm-lock.yaml", 5000), stat("src/api.ts")], brief)).toEqual([]);
  });

  test("large change over 400 lines", () => {
    const big = scopeCheck([stat("src/api.ts", 250, 151)], brief);
    expect(big.map((f) => f.title)).toEqual(["Large change: 401 lines"]);
    expect(scopeCheck([stat("src/api.ts", 250, 150)], brief)).toEqual([]);
  });

  test("promised tests with none changed", () => {
    const withTests = "## Files\n- src/api.ts\n## Proof\nAdd a unit test for login\n";
    const none = scopeCheck([stat("src/api.ts")], withTests);
    expect(none.map((f) => f.title)).toEqual(["Brief promised tests; none changed"]);
    const titles = (files: ChangedStat[]) => scopeCheck(files, withTests).map((f) => f.title);
    expect(titles([stat("src/api.ts"), stat("tests/login.test.ts")])).not.toContain(
      "Brief promised tests; none changed",
    );
    expect(titles([stat("src/api.ts"), stat("src/__tests__/x.ts")])).not.toContain(
      "Brief promised tests; none changed",
    );
  });
});

describe("Proof mentions tests", () => {
  const promised = (proof: string) =>
    scopeCheck([stat("src/api.ts")], `## Files\n- src/api.ts\n## Proof\n${proof}\n`).some(
      (f) => f.title === "Brief promised tests; none changed",
    );

  test("words that only contain test or spec don't count", () => {
    expect(promised("Check the specific behaviour by hand")).toBe(false);
    expect(promised("Run the latest build")).toBe(false);
    expect(promised("Win the contest")).toBe(false);
  });

  test("tests, testing and specs do", () => {
    expect(promised("Add a unit test")).toBe(true);
    expect(promised("Update the spec")).toBe(true);
    expect(promised("Testing by hand plus the existing tests")).toBe(true);
    expect(promised("New specs for login")).toBe(true);
  });
});

describe("brief formats", () => {
  const changed = [stat("src/a.ts"), stat("src/b.ts"), stat("src/c.ts")];
  const formats: [string, string][] = [
    [
      "colon inside the bold",
      "**Goal:** x\n**Files:** `src/a.ts`, `src/b.ts`, `src/c.ts`\n**Proof:** run it",
    ],
    [
      "colon after the bold",
      "**Goal**: x\n**Files**: `src/a.ts`, `src/b.ts`, `src/c.ts`\n**Proof**: run it",
    ],
    [
      "plain lines under a heading",
      "## Goal\nx\n## Files\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\n## Proof\nrun it",
    ],
    ["same line, no backticks", "Goal: x\nFiles: src/a.ts, src/b.ts, src/c.ts\nProof: run it"],
    ["a glob", "## Files\n- `src/*`\n## Proof\nrun it"],
    ["a deep glob", "## Files\n- src/**\n## Proof\nrun it"],
  ];
  for (const [name, text] of formats) {
    test(`listed files are fine: ${name}`, () => {
      expect(scopeCheck(changed, text)).toEqual([]);
    });
  }

  test("paths come out of each format", () => {
    expect(briefPaths(formats[0]![1])).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(briefPaths(formats[2]![1])).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(briefPaths(formats[3]![1])).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(briefPaths("**Files:** \"src/a.ts\"; 'src/b.ts'.")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("Proof stops a same-line Files section", () => {
    expect(briefSection(formats[3]![1], "Files")).toBe("src/a.ts, src/b.ts, src/c.ts");
    expect(briefSection(formats[0]![1], "Proof")).toBe("run it");
  });

  test("a simple glob covers its own directory only", () => {
    const text = "## Files\n- src/*.ts\n";
    expect(scopeCheck([stat("src/a.ts")], text)).toEqual([]);
    expect(scopeCheck([stat("src/deep/a.ts")], text).map((f) => f.title)).toEqual([
      "Outside the brief: src/deep/a.ts",
    ]);
  });

  test("a Files section with no readable paths skips the outside-the-brief rule", () => {
    const text = "## Files\nthe login screen and its helpers\n## Proof\nrun it";
    expect(briefPaths(text)).toEqual([]);
    expect(scopeCheck(changed, text)).toEqual([]);
  });

  test("no Files section at all still counts every file as outside", () => {
    const text = "## Goal\nx\n## Proof\nrun it";
    expect(scopeCheck(changed, text).filter((f) => f.severity === "blocker")).toHaveLength(1);
  });
});
