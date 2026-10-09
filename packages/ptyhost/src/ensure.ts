import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PtyHostClient } from "./client.ts";
import { HOST_VERSION } from "./protocol.ts";
import { readHostState, type HostState } from "./state.ts";

export interface EnsureOptions {
  home: string;
  /** Host entry script. Defaults to the built `bin.mjs` next to this module. */
  entry?: string;
  /** How long to wait for a freshly launched host. */
  timeoutMs?: number;
}

/** Reuse the running PTY host, or launch a detached one that outlives the caller. */
export async function ensurePtyHost({
  home,
  entry = fileURLToPath(new URL("./bin.mjs", import.meta.url)),
  timeoutMs = 10_000,
}: EnsureOptions): Promise<HostState> {
  const existing = readHostState(home);
  const probe = existing ? await probeHost(existing) : null;
  if (existing && probe) {
    if (probe.version === HOST_VERSION) return existing;
    // An older host. Replacing it would kill running crew, so only do it when idle.
    if (probe.liveSessions > 0) {
      return { ...existing, outdated: true, liveSessions: probe.liveSessions };
    }
    await stopHost(existing.pid);
  }

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
    if (state && state.pid === child.pid && (await probeHost(state))) return state;
    await sleep(50);
  }
  throw new Error(`PTY host did not start within ${timeoutMs}ms`);
}

/** Reachable host's protocol version and number of running sessions, or null if unreachable. */
async function probeHost(
  state: HostState,
): Promise<{ version: number; liveSessions: number } | null> {
  try {
    const client = await PtyHostClient.connect(state);
    try {
      const pong: unknown = await client.ping();
      const version =
        typeof pong === "object" && pong !== null && "version" in pong ? Number(pong.version) : 1;
      const liveSessions = (await client.list()).filter((s) => !s.exited).length;
      return { version, liveSessions };
    } finally {
      client.close();
    }
  } catch {
    return null;
  }
}

async function stopHost(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(50);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
