import { describe, expect, test } from "vite-plus/test";
import { briefBlocks, inline } from "../../src/features/briefs/blocks.ts";

const BRIEF = `## Goal
Login survives an expired cookie.

## Approach
Refresh the session in the **auth middleware**
before the route runs.

### Files
- \`src/auth.ts\`
* \`src/session.ts\`

**Proof**:
1. Run \`vp test\`
2. Check the login by hand

**Not doing**
Anything about signup.`;

describe("briefBlocks", () => {
  test("a full brief reads as five headings with their bodies", () => {
    const blocks = briefBlocks(BRIEF);
    expect(blocks.filter((b) => b.kind === "heading").map((b) => b.text)).toEqual([
      "Goal",
      "Approach",
      "Files",
      "Proof",
      "Not doing",
    ]);
    expect(blocks[1]).toEqual({ kind: "para", text: "Login survives an expired cookie." });
    expect(blocks[3]).toEqual({
      kind: "para",
      text: "Refresh the session in the **auth middleware** before the route runs.",
    });
    expect(blocks[5]).toEqual({ kind: "list", items: ["`src/auth.ts`", "`src/session.ts`"] });
    expect(blocks[7]).toEqual({
      kind: "list",
      items: ["Run `vp test`", "Check the login by hand"],
    });
    expect(blocks[9]).toEqual({ kind: "para", text: "Anything about signup." });
  });

  test("empty text has no blocks", () => {
    expect(briefBlocks("  \n\n")).toEqual([]);
  });

  test("a list ends at a blank line and a paragraph follows", () => {
    expect(briefBlocks("- a\n- b\n\nthen text")).toEqual([
      { kind: "list", items: ["a", "b"] },
      { kind: "para", text: "then text" },
    ]);
  });

  test("bold in the middle of a line is not a heading", () => {
    expect(briefBlocks("Do **this** now")).toEqual([{ kind: "para", text: "Do **this** now" }]);
  });
});

describe("inline", () => {
  test("splits bold and code from plain text", () => {
    expect(inline("Edit `a.ts` and **be careful** ok")).toEqual([
      { kind: "text", text: "Edit " },
      { kind: "code", text: "a.ts" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "be careful" },
      { kind: "text", text: " ok" },
    ]);
  });

  test("unclosed markers stay text", () => {
    expect(inline("a **b")).toEqual([{ kind: "text", text: "a **b" }]);
  });

  test("empty is no parts", () => {
    expect(inline("")).toEqual([]);
  });
});
