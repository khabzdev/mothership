import { CREW_STATUSES, type ClientMsg, type CrewInfo, type ServerMsg } from "./messages.ts";

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
    case "crew.roster":
      return isId(o.deckId) && Array.isArray(o.crew) && o.crew.every(isCrewInfo)
        ? { type: o.type, deckId: o.deckId, crew: o.crew }
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

/** Shallow check: the server is trusted, this guards against version skew. */
function isCrewInfo(value: unknown): value is CrewInfo {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isId(c.id) &&
    typeof c.consoleId === "number" &&
    typeof c.name === "string" &&
    CREW_STATUSES.includes(c.status as CrewInfo["status"])
  );
}
