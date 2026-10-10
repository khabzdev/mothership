import type { CrewActivity } from "@mothership/protocol";

/** What a crew member's hooks tell the station. */
export type CrewSignal =
  | { type: "idle" }
  /** No `activity`: a prompt was just submitted. With one: it's using a tool. */
  | { type: "working"; activity?: CrewActivity }
  /** `idle`: only waiting at its prompt (Claude's idle_prompt), not asking for anything. */
  | { type: "needsInput"; detail: string; idle?: boolean }
  /** Claude finished planning and asks to leave plan mode: `plan` is its brief (markdown). */
  | { type: "plan"; plan: string }
  | { type: "stopped" }
  | { type: "ended"; reason: string };

export interface LaunchOptions {
  crewId: string;
  prompt: string;
  cwd: string;
  /** Station endpoint the hooks post to. */
  hookUrl: string;
  /** Per-crew secret the station checks on every hook post. */
  hookToken: string;
  model?: string;
  /** Pick up this earlier session (from sessionOf) instead of starting a new one. */
  resume?: string;
  /** Start in plan mode: `instructions` tell the agent how to write its plan. */
  plan?: { instructions: string };
}

/** A read-only review run: the prompt goes on stdin. */
export interface ReviewOptions {
  cwd: string;
  model?: string;
}

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  /** Extra environment for the agent process. */
  env: Record<string, string>;
}

/** One agent CLI (Claude Code, Codex, …): how to launch it and how to read its hooks. */
export interface ProviderAdapter {
  id: string;
  launchPlan(options: LaunchOptions): LaunchPlan;
  /** How to run a read-only, non-interactive review of the working tree; absent if unsupported. */
  reviewPlan?(options: ReviewOptions): LaunchPlan;
  /** Map a raw hook payload to a crew signal; null for events that don't change status. */
  parseHook(payload: unknown): CrewSignal | null;
  /** The agent's own session id in a hook payload, for resuming it later. */
  sessionOf?(payload: unknown): string | undefined;
}
