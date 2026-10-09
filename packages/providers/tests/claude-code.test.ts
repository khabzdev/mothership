import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { HOOK_EVENTS, claudeCode, type LaunchOptions } from "../src/index.ts";

const options: LaunchOptions = {
  crewId: "crew-1",
  prompt: "Add a dark mode toggle",
  cwd: "/work/repo",
  hookUrl: "http://127.0.0.1:3000/api/hooks",
  hookToken: "secret-token",
};

function settingsOf(args: string[]) {
  return JSON.parse(args[args.indexOf("--settings") + 1]!) as {
    hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>;
  };
}

describe("launchPlan", () => {
  test("runs claude with inline hook settings and the brief as the prompt", () => {
    const plan = claudeCode.launchPlan(options);
    expect(plan.command).toBe("claude");
    expect(plan.cwd).toBe("/work/repo");
    expect(plan.args.slice(-2)).toEqual(["--", "Add a dark mode toggle"]);
    expect(Object.keys(settingsOf(plan.args).hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });

  test("passes crew identity through the environment, not the command line", () => {
    const plan = claudeCode.launchPlan(options);
    expect(plan.env).toEqual({
      MOTHERSHIP_CREW_ID: "crew-1",
      MOTHERSHIP_HOOK_URL: "http://127.0.0.1:3000/api/hooks",
      MOTHERSHIP_HOOK_TOKEN: "secret-token",
    });
    expect(plan.args.join(" ")).not.toContain("secret-token");
  });

  test("hiring without a task starts claude with no prompt", () => {
    const plan = claudeCode.launchPlan({ ...options, prompt: "  " });
    expect(plan.args).not.toContain("--");
    expect(plan.args.at(-2)).toBe("--settings");
  });

  test("adds the model when given", () => {
    const plan = claudeCode.launchPlan({ ...options, model: "claude-opus-5-5" });
    expect(plan.args.slice(0, 2)).toEqual(["--model", "claude-opus-5-5"]);
  });

  test("a prompt that looks like a flag stays a prompt", () => {
    const plan = claudeCode.launchPlan({ ...options, prompt: "--dangerously-skip-permissions" });
    expect(plan.args.slice(-2)).toEqual(["--", "--dangerously-skip-permissions"]);
  });

  test("every hook is a short, never-failing command", () => {
    for (const groups of Object.values(settingsOf(claudeCode.launchPlan(options).args).hooks)) {
      const [hook] = groups[0]!.hooks;
      expect(hook).toMatchObject({ type: "command", timeout: 5 });
      expect(hook!.command).toMatch(/-m 2/);
      expect(hook!.command).toMatch(/\|\| true$/);
    }
  });
});

describe("parseHook", () => {
  const base = {
    session_id: "s",
    cwd: "/work/repo",
    transcript_path: "/t",
    permission_mode: "default",
  };

  test.each([
    [{ hook_event_name: "SessionStart", source: "startup" }, { type: "idle" }],
    [{ hook_event_name: "UserPromptSubmit", prompt: "go" }, { type: "working" }],
    [
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/work/repo/src/a.ts" },
      },
      { type: "working", activity: { tool: "Edit", filePath: "/work/repo/src/a.ts" } },
    ],
    [
      {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x", path: "/work/repo/src" },
      },
      { type: "working", activity: { tool: "Grep", filePath: "/work/repo/src" } },
    ],
    [
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "vp test" } },
      { type: "working", activity: { tool: "Bash", command: "vp test" } },
    ],
    [
      { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://x" } },
      { type: "working", activity: { tool: "WebFetch" } },
    ],
    [
      {
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "rm -rf dist" },
      },
      { type: "needsInput", detail: "Approve Bash: rm -rf dist" },
    ],
    [
      {
        hook_event_name: "PermissionRequest",
        tool_name: "Write",
        tool_input: { file_path: "/work/repo/a.ts" },
      },
      { type: "needsInput", detail: "Approve Write: /work/repo/a.ts" },
    ],
    [
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Bash",
      },
      { type: "needsInput", detail: "Claude needs your permission to use Bash" },
    ],
    [
      {
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
        message: "Claude is waiting for your input",
      },
      { type: "needsInput", detail: "Claude is waiting for your input" },
    ],
    [{ hook_event_name: "Notification", notification_type: "auth_success", message: "ok" }, null],
    [{ hook_event_name: "Stop", stop_hook_active: false }, { type: "stopped" }],
    [
      { hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
      { type: "ended", reason: "prompt_input_exit" },
    ],
    [{ hook_event_name: "PostToolUse", tool_name: "Edit" }, null],
  ])("%j → %j", (payload, signal) => {
    expect(claudeCode.parseHook({ ...base, ...payload })).toEqual(signal);
  });

  test.each([null, "x", 42, {}, { hook_event_name: 5 }, { hook_event_name: "PreToolUse" }])(
    "ignores malformed payload %j",
    (payload) => {
      expect(claudeCode.parseHook(payload)).toBeNull();
    },
  );

  test("long approval details are truncated", () => {
    const signal = claudeCode.parseHook({
      ...base,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "x".repeat(500) },
    });
    expect(signal).toMatchObject({ type: "needsInput" });
    expect((signal as { detail: string }).detail.length).toBeLessThanOrEqual(200);
  });
});

describe("hook commands (run the way Claude runs them)", () => {
  let server: Server | undefined;

  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  function runHook(command: string, env: Record<string, string>, stdin: string) {
    return new Promise<{ code: number | null; ms: number }>((resolve) => {
      const started = Date.now();
      const child = spawn("/bin/sh", ["-c", command], { env: { ...process.env, ...env } });
      child.stdin.end(stdin);
      child.on("close", (code) => resolve({ code, ms: Date.now() - started }));
    });
  }

  test("posts the payload with crew headers to the hook URL", async () => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/hooks`;

    const plan = claudeCode.launchPlan({ ...options, hookUrl: url });
    const command = settingsOf(plan.args).hooks.PreToolUse![0]!.hooks[0]!.command;
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/a 'b\" $c" },
    });

    const result = await runHook(command, plan.env, payload);
    expect(result.code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]!.body).toBe(payload);
    expect(received[0]!.headers).toMatchObject({
      "content-type": "application/json",
      "x-mothership-crew": "crew-1",
      "x-mothership-token": "secret-token",
    });
  });

  test("never fails or hangs when the station is down", async () => {
    const plan = claudeCode.launchPlan({ ...options, hookUrl: "http://127.0.0.1:9/api/hooks" });
    const command = settingsOf(plan.args).hooks.Stop![0]!.hooks[0]!.command;
    const result = await runHook(command, plan.env, "{}");
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(3000);
  });
});
