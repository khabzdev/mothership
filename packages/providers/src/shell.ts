import type { LaunchOptions, LaunchPlan, ProviderAdapter } from "./types.ts";

/**
 * A plain login shell at a console (agent-office's B): no hooks and no prompt, so it never changes
 * status by itself.
 */
function launchPlan(options: LaunchOptions): LaunchPlan {
  return { command: process.env.SHELL || "/bin/sh", args: ["-l"], cwd: options.cwd, env: {} };
}

export const shell: ProviderAdapter = { id: "shell", launchPlan, parseHook: () => null };
