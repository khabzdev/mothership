import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface HostState {
  port: number;
  token: string;
  pid: number;
  /** Protocol version the host speaks (absent for v1 hosts). */
  version?: number;
  /** Set by ensurePtyHost when an older host is kept because crew are still running on it. */
  outdated?: true;
  /** Running sessions on an outdated host. */
  liveSessions?: number;
}

export function stateFile(home: string): string {
  return join(home, "ptyhost.json");
}

export function readHostState(home: string): HostState | null {
  try {
    return JSON.parse(readFileSync(stateFile(home), "utf8")) as HostState;
  } catch {
    return null;
  }
}
