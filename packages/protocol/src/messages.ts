export const PROTOCOL_VERSION = 2;

export type CrewId = string;
export type DeckId = string;

/** Same lifecycle as an agent-office worker. */
export const CREW_STATUSES = [
  "starting",
  "idle",
  "working",
  "needs_input",
  "done",
  "asleep",
] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];

/** What the crew member acts out at its console, read off its latest tool call. */
export const CREW_ACTIONS = ["read", "edit", "test", "web", "failing"] as const;
export type CrewAction = (typeof CREW_ACTIONS)[number];

/** A tool call as reported by the agent's hooks. */
export type CrewActivity = {
  tool: string;
  filePath?: string;
  command?: string;
};

export const CREW_KINDS = ["agent", "shell"] as const;
/** An agent (Claude Code) or a plain shell opened at a console (agent-office's B). */
export type CrewKind = (typeof CREW_KINDS)[number];

/** A crew member at a console on a deck (agent-office's WorkerInfo). */
export interface CrewInfo {
  id: CrewId;
  kind: CrewKind;
  deckId: DeckId;
  consoleId: number;
  name: string;
  color: string;
  /** Which KayKit character model to use. */
  character: string;
  task: string;
  status: CrewStatus;
  action?: CrewAction;
  /** What it's waiting on when it needs you (e.g. "Approve Bash: npm test"). */
  detail?: string;
  /** When the current status began (ms since epoch). */
  statusSince: number;
  branch?: string;
  prUrl?: string;
}

/** A styled run of text on a terminal row: [text, fg, bg, flags]. */
export type Run = [string, number, number, number];
/** Colour encoding: -1 default, 0..255 palette, >= RGB_FLAG means RGB_FLAG | rgb. */
export const RGB_FLAG = 0x1000000;
export const FLAG_BOLD = 1;
export const FLAG_INVERSE = 2;
export const FLAG_DIM = 4;

/** A crew terminal's visible rows, for the console's holo screen. */
export interface ScreenFrame {
  cols: number;
  rows: number;
  lines: Run[][];
}

/** Browser → station server. */
export type ClientMsg =
  | { type: "terminal.attach"; crewId: CrewId }
  | { type: "terminal.detach"; crewId: CrewId }
  | { type: "terminal.input"; crewId: CrewId; data: string }
  | { type: "terminal.resize"; crewId: CrewId; cols: number; rows: number };

/** Station server → browser. */
export type ServerMsg =
  | { type: "hello"; protocolVersion: number }
  | { type: "terminal.snapshot"; crewId: CrewId; data: string; cols: number; rows: number }
  | { type: "terminal.output"; crewId: CrewId; data: string }
  | { type: "terminal.exit"; crewId: CrewId; code: number | null }
  | { type: "crew.roster"; deckId: DeckId; crew: CrewInfo[] }
  | { type: "crew.screen"; crewId: CrewId; frame: ScreenFrame }
  | { type: "error"; message: string };

export type MsgOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;
