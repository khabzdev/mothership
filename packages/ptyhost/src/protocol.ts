/** Wire protocol between the station server and the PTY host (local, token-authenticated). */

export interface SpawnSpec {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  /** Extra environment variables, merged over the host's environment. */
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface SessionInfo {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
  signal?: number;
}

export interface AttachResult {
  /** Serialized screen + scrollback, replayable into xterm.js. */
  snapshot: string;
  cols: number;
  rows: number;
  exited: boolean;
}

export type HostRequest =
  | { type: "ping" }
  | { type: "list" }
  | ({ type: "spawn" } & SpawnSpec)
  | { type: "write"; id: string; data: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "kill"; id: string; signal?: string }
  | { type: "dispose"; id: string }
  | { type: "attach"; id: string }
  | { type: "attachAll" }
  | { type: "detach"; id: string };

export type RequestFrame = HostRequest & { reqId: number };

export interface ResultMap {
  ping: "pong";
  list: SessionInfo[];
  spawn: SessionInfo;
  write: null;
  resize: null;
  kill: null;
  dispose: null;
  attach: AttachResult;
  attachAll: null;
  detach: null;
}

export type ResponseFrame =
  | { type: "response"; reqId: number; ok: true; result: unknown }
  | { type: "response"; reqId: number; ok: false; error: string };

export interface OutputEvent {
  type: "output";
  id: string;
  data: string;
}

export interface ExitEvent {
  type: "exit";
  id: string;
  exitCode: number;
  signal?: number;
}

export type HostEvent = OutputEvent | ExitEvent;

export type HostFrame = ResponseFrame | HostEvent;
