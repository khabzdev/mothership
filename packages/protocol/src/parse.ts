import { MISSION_STATES, type Mission } from "@mothership/mission-engine";
import {
  CREW_STATUSES,
  type ClientMsg,
  type CrewActivity,
  type CrewStatus,
  type ServerMsg,
} from "./messages.ts";

const MAX_TERMINAL_SIZE = 1000;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/** Parse an untrusted frame from the browser. Returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  const o = parseObject(raw);
  if (!o || !isId(o.crewId)) return null;
  const crewId = o.crewId;
  switch (o.type) {
    case "terminal.attach":
    case "terminal.detach":
      return { type: o.type, crewId };
    case "terminal.input":
      return typeof o.data === "string" ? { type: o.type, crewId, data: o.data } : null;
    case "terminal.resize":
      return isTerminalSize(o.cols) && isTerminalSize(o.rows)
        ? { type: o.type, crewId, cols: o.cols, rows: o.rows }
        : null;
    default:
      return null;
  }
}

/** Parse a frame from the station server. Returns null for anything malformed. */
export function parseServerMsg(raw: string): ServerMsg | null {
  const o = parseObject(raw);
  if (!o) return null;
  switch (o.type) {
    case "hello":
      return typeof o.protocolVersion === "number"
        ? { type: o.type, protocolVersion: o.protocolVersion }
        : null;
    case "terminal.snapshot":
      return isId(o.crewId) &&
        typeof o.data === "string" &&
        isTerminalSize(o.cols) &&
        isTerminalSize(o.rows)
        ? { type: o.type, crewId: o.crewId, data: o.data, cols: o.cols, rows: o.rows }
        : null;
    case "terminal.output":
      return isId(o.crewId) && typeof o.data === "string"
        ? { type: o.type, crewId: o.crewId, data: o.data }
        : null;
    case "terminal.exit":
      return isId(o.crewId) && (o.code === null || Number.isInteger(o.code))
        ? { type: o.type, crewId: o.crewId, code: o.code as number | null }
        : null;
    case "crew.status": {
      if (!isId(o.crewId) || !(o.missionId === null || isId(o.missionId))) return null;
      if (!isCrewStatus(o.status)) return null;
      const activity = o.activity === undefined ? undefined : parseActivity(o.activity);
      if (activity === null) return null;
      return {
        type: o.type,
        crewId: o.crewId,
        missionId: o.missionId,
        status: o.status,
        ...(activity && { activity }),
      };
    }
    case "mission.updated":
      return isId(o.missionId) && isId(o.deckId) && isMission(o.mission)
        ? { type: o.type, missionId: o.missionId, deckId: o.deckId, mission: o.mission }
        : null;
    case "error":
      return typeof o.message === "string" ? { type: o.type, message: o.message } : null;
    default:
      return null;
  }
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTerminalSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_TERMINAL_SIZE;
}

function isCrewStatus(value: unknown): value is CrewStatus {
  return CREW_STATUSES.includes(value as CrewStatus);
}

function parseActivity(value: unknown): CrewActivity | null {
  if (typeof value !== "object" || value === null) return null;
  const { tool, filePath, command } = value as Record<string, unknown>;
  if (typeof tool !== "string") return null;
  if (filePath !== undefined && typeof filePath !== "string") return null;
  if (command !== undefined && typeof command !== "string") return null;
  return {
    tool,
    ...(filePath !== undefined && { filePath }),
    ...(command !== undefined && { command }),
  };
}

/** Shallow check: the server is trusted, this guards against version skew. */
function isMission(value: unknown): value is Mission {
  if (typeof value !== "object" || value === null) return false;
  const { state, brief, attempts, maxAttempts } = value as Record<string, unknown>;
  return (
    MISSION_STATES.includes(state as never) &&
    typeof brief === "object" &&
    brief !== null &&
    typeof attempts === "number" &&
    typeof maxAttempts === "number"
  );
}
