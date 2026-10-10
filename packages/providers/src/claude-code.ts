import type { CrewActivity } from "@mothership/protocol";
import type { CrewSignal, LaunchOptions, LaunchPlan, ProviderAdapter } from "./types.ts";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

const NEEDS_INPUT_NOTIFICATIONS = new Set([
  "permission_prompt",
  "idle_prompt",
  "agent_needs_input",
]);
const MAX_DETAIL = 200;

/**
 * Posts the hook payload (stdin) to the station. Crew identity comes from the environment so the
 * token never appears in `ps`. Short timeout and `|| true`: a down station must never block Claude.
 */
const POST_HOOK = [
  "curl -s -m 2 -o /dev/null -X POST",
  "-H 'content-type: application/json'",
  '-H "x-mothership-crew: $MOTHERSHIP_CREW_ID"',
  '-H "x-mothership-token: $MOTHERSHIP_HOOK_TOKEN"',
  '--data-binary @- "$MOTHERSHIP_HOOK_URL"',
  "|| true",
].join(" ");

function hookSettings() {
  const hook = { type: "command", command: POST_HOOK, timeout: 5, async: true };
  return {
    hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [hook] }]])),
  };
}

function launchPlan(options: LaunchOptions): LaunchPlan {
  return {
    command: "claude",
    args: [
      ...(options.model ? ["--model", options.model] : []),
      ...(options.resume ? ["--resume", options.resume] : []),
      "--settings",
      JSON.stringify(hookSettings()),
      // End of options: a task starting with "-" must not be read as a flag.
      ...(options.prompt.trim() ? ["--", options.prompt] : []),
    ],
    cwd: options.cwd,
    env: {
      MOTHERSHIP_CREW_ID: options.crewId,
      MOTHERSHIP_HOOK_URL: options.hookUrl,
      MOTHERSHIP_HOOK_TOKEN: options.hookToken,
    },
  };
}

function parseHook(payload: unknown): CrewSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  switch (p.hook_event_name) {
    case "SessionStart":
      return { type: "idle" };
    case "UserPromptSubmit":
      return { type: "working" };
    case "PreToolUse": {
      if (typeof p.tool_name !== "string") return null;
      return { type: "working", activity: activityOf(p.tool_name, p.tool_input) };
    }
    case "PermissionRequest": {
      if (typeof p.tool_name !== "string") return null;
      const { filePath, command } = activityOf(p.tool_name, p.tool_input);
      const target = command ?? filePath;
      return {
        type: "needsInput",
        detail: clip(`Approve ${p.tool_name}${target ? `: ${target}` : ""}`),
      };
    }
    case "Notification":
      return typeof p.notification_type === "string" &&
        NEEDS_INPUT_NOTIFICATIONS.has(p.notification_type)
        ? {
            type: "needsInput",
            detail: clip(typeof p.message === "string" ? p.message : "Crew needs input"),
            // Claude waiting at its prompt, not asking anything: the station may know better.
            ...(p.notification_type === "idle_prompt" && { idle: true }),
          }
        : null;
    case "Stop":
      return { type: "stopped" };
    case "SessionEnd":
      return { type: "ended", reason: typeof p.reason === "string" ? p.reason : "other" };
    default:
      return null;
  }
}

function activityOf(tool: string, input: unknown): CrewActivity {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const filePath = [i.file_path, i.notebook_path, i.path].find((v) => typeof v === "string");
  const command = typeof i.command === "string" ? i.command : undefined;
  return {
    tool,
    ...(typeof filePath === "string" && { filePath }),
    ...(command !== undefined && { command }),
  };
}

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function sessionOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const id = (payload as Record<string, unknown>).session_id;
  return typeof id === "string" && /^[\w-]{1,128}$/.test(id) ? id : undefined;
}

export const claudeCode: ProviderAdapter = {
  id: "claude-code",
  launchPlan,
  parseHook,
  sessionOf,
};
