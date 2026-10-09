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

/** A crew member at a console on a deck (agent-office's WorkerInfo). */
export interface CrewInfo {
  id: CrewId;
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
  | { type: "error"; message: string };

export type MsgOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;
