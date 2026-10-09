import { describe, expect, test } from "vite-plus/test";
import { diffLines } from "../../src/features/changes/ui/ChangesPanel.tsx";

describe("diffLines", () => {
  test("numbers old and new lines and drops file headers", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "index 1..2 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+TWO",
      "",
    ].join("\n");
    expect(diffLines(diff)).toEqual([
      { kind: "hunk", old: "", now: "", code: "@@ -1,2 +1,2 @@" },
      { kind: "ctx", old: "1", now: "1", code: "one" },
      { kind: "del", old: "2", now: "", code: "two" },
      { kind: "add", old: "", now: "2", code: "TWO" },
    ]);
  });
});
