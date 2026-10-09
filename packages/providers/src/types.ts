import type { CrewActivity } from "@mothership/protocol";

/** What a crew member's hooks tell the station. */
export type CrewSignal =
  | { type: "idle" }
  | { type: "working"; activity?: CrewActivity }
  | { type: "needsInput"; detail: string }
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
  /** Map a raw hook payload to a crew signal; null for events that don't change status. */
  parseHook(payload: unknown): CrewSignal | null;
  /** The agent's own session id in a hook payload, for resuming it later. */
  sessionOf?(payload: unknown): string | undefined;
}
