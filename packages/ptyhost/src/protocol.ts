/** Wire protocol between the station server and the PTY host (local, token-authenticated). */

/**
 * Bump when the host gains or changes requests. Hosts outlive the station, so a newer station
 * must detect an older host (v1 hosts answered ping with "pong").
 */
export const HOST_VERSION = 3;

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
  /** Sequence number of the last output chunk included in the snapshot. */
  seq: number;
}

/** A styled run of text on a terminal row: [text, fg, bg, flags]. */
export type Run = [string, number, number, number];
/** Colour encoding: -1 default, 0..255 palette, >= RGB_FLAG means RGB_FLAG | rgb. */
export const RGB_FLAG = 0x1000000;
export const FLAG_BOLD = 1;
export const FLAG_INVERSE = 2;
export const FLAG_DIM = 4;

/** The visible rows of a session's screen as styled runs. */
export interface ScreenFrame {
  cols: number;
  rows: number;
  lines: Run[][];
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
  | { type: "snapshot"; id: string }
  | { type: "screen"; id: string }
  | { type: "attachAll" }
  | { type: "detach"; id: string };

export type RequestFrame = HostRequest & { reqId: number };

export interface ResultMap {
  ping: { version: number };
  list: SessionInfo[];
  spawn: SessionInfo;
  write: null;
  resize: null;
  kill: null;
  dispose: null;
  attach: AttachResult;
  snapshot: AttachResult;
  screen: ScreenFrame;
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
  /** Per-session chunk number, starting at 1; lets viewers line output up with a snapshot. */
  seq: number;
}

export interface ExitEvent {
  type: "exit";
  id: string;
  exitCode: number;
  signal?: number;
}

export type HostEvent = OutputEvent | ExitEvent;

export type HostFrame = ResponseFrame | HostEvent;
