import { describe, expect, test } from "vite-plus/test";
import { commandAction, toolAction } from "../../src/features/crew/actions.ts";

describe("toolAction", () => {
  test.each([
    ["Read", undefined, "read"],
    ["Grep", undefined, "read"],
    ["Edit", undefined, "edit"],
    ["Write", undefined, "edit"],
    ["WebFetch", undefined, "web"],
    ["mcp__fetch__fetch", undefined, "web"],
    ["mcp__db__query", undefined, undefined],
    ["Bash", "npm test", "test"],
    ["Bash", "git status", "read"],
    ["Bash", "rm -rf dist", undefined],
    ["TodoWrite", undefined, undefined],
  ] as const)("%s %s → %s", (tool, command, action) => {
    expect(toolAction(tool, command)).toBe(action);
  });
});

describe("commandAction", () => {
  test.each([
    ["vp test", "test"],
    ["vp run build", "test"],
    ["pnpm run test:unit", "test"],
    ["CI=1 npx vitest run", "test"],
    ["cargo test", "test"],
    ["cd app && grep -r foo .", "read"],
    ["git log --oneline", "read"],
    ["cat a.txt | wc -l", "read"],
    ["vp dev", undefined],
    ["npm install", undefined],
    ["mkdir out && ls", undefined],
  ] as const)("%s → %s", (command, action) => {
    expect(commandAction(command)).toBe(action);
  });
});
