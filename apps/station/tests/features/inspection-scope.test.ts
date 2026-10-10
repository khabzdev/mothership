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
      const section = briefSection(text, "Files");
      expect(section).toContain("a.ts");
      expect(section).toContain("b.ts");
      expect(section).not.toContain("t\n");
      expect(section).not.toMatch(/Proof/);
    }
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
