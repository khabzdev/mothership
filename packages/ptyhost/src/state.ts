import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface HostState {
  port: number;
  token: string;
  pid: number;
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
