import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PtyHostClient } from "./client.ts";
import { stateFile, type HostState } from "./server.ts";

export interface EnsureOptions {
  home: string;
  /** Host entry script. Defaults to the built `bin.mjs` next to this module. */
  entry?: string;
  /** How long to wait for a freshly launched host. */
  timeoutMs?: number;
}

export function readHostState(home: string): HostState | null {
  try {
    return JSON.parse(readFileSync(stateFile(home), "utf8")) as HostState;
  } catch {
    return null;
  }
}

/** Reuse the running PTY host, or launch a detached one that outlives the caller. */
export async function ensurePtyHost({
  home,
  entry = fileURLToPath(new URL("./bin.mjs", import.meta.url)),
  timeoutMs = 10_000,
}: EnsureOptions): Promise<HostState> {
  const existing = readHostState(home);
  if (existing && (await reachable(existing))) return existing;

  if (!existsSync(entry)) throw new Error(`PTY host entry not found: ${entry}`);
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MOTHERSHIP_HOME: home },
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readHostState(home);
    if (state && state.pid === child.pid && (await reachable(state))) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`PTY host did not start within ${timeoutMs}ms`);
}

async function reachable(state: HostState): Promise<boolean> {
  try {
    const client = await PtyHostClient.connect(state);
    await client.ping();
    client.close();
    return true;
  } catch {
    return false;
  }
}
