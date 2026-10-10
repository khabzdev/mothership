import {
  BRIEF_STATES,
  type BriefInfo,
  CHECK_VERDICTS,
  CREW_KINDS,
  CREW_STATUSES,
  type ClientMsg,
  type CloneInfo,
  type ConsoleLabel,
  type CheckVerdict,
  type CrewInfo,
  type DeckCheck,
  INSPECTION_STATES,
  type InspectionInfo,
  type InspectionState,
  PREFLIGHT_STATES,
  type PreflightInfo,
  type Run,
  type ScreenFrame,
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
    case "crew.roster":
      return isId(o.deckId) && Array.isArray(o.crew) && o.crew.every(isCrewInfo)
        ? { type: o.type, deckId: o.deckId, crew: o.crew }
        : null;
    case "crew.screen":
      return isId(o.crewId) && isScreenFrame(o.frame)
        ? { type: o.type, crewId: o.crewId, frame: o.frame }
        : null;
    case "crew.preflight":
      return isId(o.deckId) &&
        isId(o.crewId) &&
        isId(o.preflightId) &&
        typeof o.check === "string" &&
        isVerdict(o.verdict) &&
        typeof o.done === "boolean"
        ? {
            type: o.type,
            deckId: o.deckId,
            crewId: o.crewId,
            preflightId: o.preflightId,
            check: o.check,
            verdict: o.verdict,
            done: o.done,
          }
        : null;
    case "crew.brief":
      return isId(o.deckId) && isId(o.crewId)
        ? { type: o.type, deckId: o.deckId, crewId: o.crewId }
        : null;
    case "crew.inspection":
      return isId(o.deckId) &&
        isId(o.crewId) &&
        isId(o.inspectionId) &&
        INSPECTION_STATES.includes(o.state as InspectionState) &&
        (o.failed === undefined || typeof o.failed === "string")
        ? {
            type: o.type,
            deckId: o.deckId,
            crewId: o.crewId,
            inspectionId: o.inspectionId,
            state: o.state as InspectionState,
            ...(o.failed !== undefined && { failed: o.failed as string }),
          }
        : null;
    case "deck.labels":
      return isId(o.deckId) && Array.isArray(o.labels) && o.labels.every(isConsoleLabel)
        ? { type: o.type, deckId: o.deckId, labels: o.labels }
        : null;
    case "deck.checks":
      return isId(o.deckId) &&
        (o.armed === null || typeof o.armed === "boolean") &&
        Array.isArray(o.checks) &&
        o.checks.every(isDeckCheck) &&
        typeof o.inspector === "boolean"
        ? {
            type: o.type,
            deckId: o.deckId,
            armed: o.armed,
            checks: o.checks,
            inspector: o.inspector,
          }
        : null;
    case "deck.clones":
      return Array.isArray(o.clones) && o.clones.every(isCloneInfo)
        ? { type: o.type, clones: o.clones }
        : null;
    case "pr.merged":
      return isId(o.deckId) && Number.isInteger(o.number) && typeof o.title === "string"
        ? {
            type: o.type,
            deckId: o.deckId,
            number: o.number as number,
            title: o.title,
            ...(isId(o.crewId) && { crewId: o.crewId }),
          }
        : null;
    case "error":
      return typeof o.message === "string" ? { type: o.type, message: o.message } : null;
    default:
      return null;
  }
}

function isCloneInfo(value: unknown): value is CloneInfo {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isId(c.id) &&
    typeof c.spec === "string" &&
    typeof c.name === "string" &&
    ["cloning", "done", "failed"].includes(c.state as string) &&
    typeof c.progress === "string"
  );
}

function isConsoleLabel(value: unknown): value is ConsoleLabel {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return Number.isInteger(l.consoleId) && typeof l.text === "string" && typeof l.color === "string";
}

function isDeckCheck(value: unknown): value is DeckCheck {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.command === "string" &&
    typeof c.timeoutMs === "number" &&
    typeof c.enabled === "boolean"
  );
}

function isRun(value: unknown): value is Run {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    typeof value[0] === "string" &&
    value.slice(1).every(Number.isInteger)
  );
}

function isScreenFrame(value: unknown): value is ScreenFrame {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    isTerminalSize(f.cols) &&
    isTerminalSize(f.rows) &&
    Array.isArray(f.lines) &&
    f.lines.every((line) => Array.isArray(line) && line.every(isRun))
  );
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
    CREW_KINDS.includes(c.kind as CrewInfo["kind"]) &&
    typeof c.consoleId === "number" &&
    typeof c.name === "string" &&
    CREW_STATUSES.includes(c.status as CrewInfo["status"]) &&
    (c.preflight === undefined || isPreflightInfo(c.preflight)) &&
    (c.brief === undefined || isBriefInfo(c.brief)) &&
    (c.inspection === undefined || isInspectionInfo(c.inspection)) &&
    (c.cleanBriefs === undefined ||
      (Number.isInteger(c.cleanBriefs) && (c.cleanBriefs as number) >= 0))
  );
}

function isBriefInfo(value: unknown): value is BriefInfo {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    Number.isInteger(b.revision) &&
    (b.revision as number) >= 1 &&
    BRIEF_STATES.includes(b.state as BriefInfo["state"]) &&
    typeof b.goal === "string"
  );
}

function isInspectionInfo(value: unknown): value is InspectionInfo {
  if (typeof value !== "object" || value === null) return false;
  const i = value as Record<string, unknown>;
  return (
    INSPECTION_STATES.includes(i.state as InspectionState) &&
    Number.isInteger(i.blockers) &&
    (i.blockers as number) >= 0 &&
    Number.isInteger(i.notes) &&
    (i.notes as number) >= 0 &&
    (i.firstBlocker === undefined || typeof i.firstBlocker === "string") &&
    (i.queued === undefined || i.queued === true) &&
    (i.failed === undefined || i.failed === true)
  );
}

function isVerdict(value: unknown): value is CheckVerdict {
  return CHECK_VERDICTS.includes(value as CheckVerdict);
}

function isPreflightInfo(value: unknown): value is PreflightInfo {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    PREFLIGHT_STATES.includes(p.state as PreflightInfo["state"]) &&
    Array.isArray(p.checks) &&
    p.checks.every(
      (c: unknown) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).name === "string" &&
        ((c as Record<string, unknown>).verdict === undefined ||
          isVerdict((c as Record<string, unknown>).verdict)),
    ) &&
    typeof p.attempt === "number" &&
    typeof p.fuel === "number" &&
    typeof p.maxFuel === "number"
  );
}
