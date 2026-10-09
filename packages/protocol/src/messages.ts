import type { Mission } from "@mothership/mission-engine";

export const PROTOCOL_VERSION = 1;

export type CrewId = string;
export type MissionId = string;
export type DeckId = string;

export const CREW_STATUSES = ["offline", "idle", "working", "redAlert", "done"] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];

/** What the crew member is doing right now (from the PreToolUse hook). Drives movement. */
export type CrewActivity = {
  tool: string;
  filePath?: string;
  command?: string;
};

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
  | {
      type: "crew.status";
      crewId: CrewId;
      missionId: MissionId | null;
      status: CrewStatus;
      activity?: CrewActivity;
    }
  | { type: "mission.updated"; missionId: MissionId; deckId: DeckId; mission: Mission }
  | { type: "error"; message: string };

export type MsgOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;
