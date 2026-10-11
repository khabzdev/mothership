// Ported from agent-office (src/shared/actions.ts): what a crew member acts out, read off its
// latest tool call: flipping papers while it reads, typing while it edits, leaning back while its
// tests run, a globe spinning while it's on the web.
import type { CrewAction } from "@spaceship/protocol";

/** Tool names, lowercased, across Claude Code, Codex and OpenCode. */
const READ_TOOLS = new Set([
  "read",
  "read_file",
  "view",
  "view_file",
  "grep",
  "grep_files",
  "glob",
  "ls",
  "list",
  "list_dir",
  "list_files",
  "find",
  "codesearch",
  "search_files",
  "notebookread",
]);
const EDIT_TOOLS = new Set([
  "edit",
  "multiedit",
  "write",
  "write_file",
  "create_file",
  "notebookedit",
  "apply_patch",
  "patch",
  "str_replace",
  "str_replace_editor",
  "str_replace_based_edit_tool",
]);
const WEB_TOOLS = new Set([
  "websearch",
  "webfetch",
  "web_search",
  "web_fetch",
  "fetch",
  "browse",
  "search_web",
]);
const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "exec_command",
  "local_shell",
  "run_command",
  "terminal",
]);

/** The action for a tool call (`tool` is its name, `command` the shell command if any). */
export function toolAction(tool: string, command?: string): CrewAction | undefined {
  const name = tool.toLowerCase().replace(/^.*[.:/]/, "");
  if (READ_TOOLS.has(name)) return "read";
  if (EDIT_TOOLS.has(name)) return "edit";
  if (WEB_TOOLS.has(name)) return "web";
  if (name.startsWith("mcp__")) return /web|fetch|brows|url|http/.test(name) ? "web" : undefined;
  if (SHELL_TOOLS.has(name)) return command ? commandAction(command) : undefined;
  return undefined;
}

/** Runs tests, a build, a type check or a linter. */
const CHECK =
  /^(?:tsc|vue-tsc|svelte-check|jest|vitest|mocha|ava|pytest|py\.test|tox|nox|rspec|phpunit|karma|mypy|pyright|eslint|make|cmake|ninja|gradlew?|mvnw?|xcodebuild|ctest|bazel|bazelisk|webpack|rollup|turbo|nx|sbt|vp)$|^(?:go (?:test|build|vet)|cargo (?:test|build|check|clippy|nextest)|dotnet (?:test|build)|swift (?:test|build)|mix (?:test|compile)|zig (?:build|test)|deno (?:test|check)|bun test|(?:flutter|dart) test|playwright test|cypress run|ruff check|(?:next|vite|nuxt|astro|ng) build|rake (?:test|spec))\b/;
/** A package.json script that tests or builds. */
const CHECK_SCRIPT =
  /^(?:t|test|tests|build|check|lint|typecheck|type-check|tsc|compile|e2e|spec|verify|ci)(?:[:-]\S*)?$/;
/** Looks at code or history without changing it. */
const READ =
  /^(?:cat|bat|head|tail|less|more|grep|egrep|fgrep|rg|ag|ack|find|fd|ls|tree|wc|stat|file|du|jq|diff|nl|awk)$/;
const READ_SUB =
  /^sed -n\b|^git(?: (?:-C \S+|--?[\w-]+(?:=\S+)?))* (?:log|show|diff|status|blame|grep|ls-files|shortlog)\b|^gh (?:issue|pr|repo|run) (?:view|list|diff)\b/;
/** Leading `FOO=bar` assignments and wrappers in front of the program that really runs. */
const PREFIX =
  /^(?:\w+=(?:'[^']*'|"[^"]*"|\S*)\s+|(?:sudo|time|nice|nohup|command|exec|env|npx|bunx|pnpx|caffeinate|xvfb-run)\s+|(?:bundle exec|poetry run|uv run|pipenv run|pdm run|pnpm exec|yarn exec|python3? -m)\s+|timeout\s+\S+\s+)/;

/** 'test' for a command that runs tests or a build, 'read' for one that only looks at things. */
export function commandAction(command: string): "test" | "read" | undefined {
  let first: "read" | undefined;
  let leading = true;
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const words = normalize(part);
    if (!words.length) continue;
    if (isCheck(words)) return "test";
    // Moving around first (`cd app && grep …`) doesn't decide it; the first real command does.
    if (!leading || /^(?:cd|pushd|export|source|set|\.)$/.test(words[0]!)) continue;
    leading = false;
    if (READ.test(words[0]!) || READ_SUB.test(words.join(" "))) first = "read";
  }
  return first;
}

function normalize(part: string): string[] {
  let s = part.replace(/^[\s({]+/, "").trim();
  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(PREFIX, "");
  }
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length) words[0] = words[0]!.replace(/^.*[/\\]/, "").replace(/\.(?:cmd|exe|bat)$/i, "");
  return words;
}

function isCheck(words: string[]): boolean {
  const [prog = "", ...rest] = words;
  if (prog === "vp")
    return (
      /^(?:test|check|build|run)$/.test(rest[0] ?? "") &&
      (rest[0] !== "run" || CHECK_SCRIPT.test(rest[1] ?? ""))
    );
  if (CHECK.test(prog) || CHECK.test(`${prog} ${rest[0] ?? ""}`)) return true;
  if (/^(?:node|tsx|bun|deno)$/.test(prog) && rest.includes("--test")) return true;
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog)) {
    const script = rest.find((w) => !w.startsWith("-") && w !== "run" && w !== "run-script");
    return !!script && CHECK_SCRIPT.test(script);
  }
  return false;
}
