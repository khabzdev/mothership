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

export const CHECK_VERDICTS = ["go", "nogo", "skipped"] as const;
/** How one pre-flight check came out. */
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export const PREFLIGHT_STATES = ["running", "go", "nogo", "cancelled"] as const;

/** A crew member's latest pre-flight this flight, as the roster shows it. */
export interface PreflightInfo {
  state: (typeof PREFLIGHT_STATES)[number];
  /** Every check in the run, in order; `verdict` is missing until that check is done. */
  checks: { name: string; verdict?: CheckVerdict }[];
  attempt: number;
  /** Hand-backs left this flight. */
  fuel: number;
  maxFuel: number;
}

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
  preflight?: PreflightInfo;
}

/** One pre-flight check a deck runs before its crew may hand work back. */
export interface DeckCheck {
  id: string;
  name: string;
  command: string;
  timeoutMs: number;
  enabled: boolean;
}

/** A sign over a console (agent-office's desk label). */
export interface ConsoleLabel {
  consoleId: number;
  text: string;
  /** Board colour, one of the label colours. */
  color: string;
}

/** A repo being cloned into a new deck (agent-office: its floor on the panel says how far along). */
export interface CloneInfo {
  id: string;
  /** What was asked for: owner/name, a URL. */
  spec: string;
  /** The deck it becomes. */
  name: string;
  state: "cloning" | "done" | "failed";
  /** "Downloading 64% · 231 MiB · 1.5 MiB/s". */
  progress: string;
  /** The new deck, once done. */
  deckId?: string;
  error?: string;
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
  /** One pre-flight check finished; `done` is true on the run's last check. */
  | {
      type: "crew.preflight";
      deckId: DeckId;
      crewId: CrewId;
      preflightId: string;
      check: string;
      verdict: CheckVerdict;
      done: boolean;
    }
  | { type: "deck.labels"; deckId: DeckId; labels: ConsoleLabel[] }
  | { type: "deck.checks"; deckId: DeckId; armed: boolean | null; checks: DeckCheck[] }
  | { type: "deck.clones"; clones: CloneInfo[] }
  /** A pull request merged: the launch klaxon. `crewId` is the crew member it came from, if known. */
  | { type: "pr.merged"; deckId: DeckId; number: number; title: string; crewId?: CrewId }
  | { type: "error"; message: string };

export type MsgOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;
