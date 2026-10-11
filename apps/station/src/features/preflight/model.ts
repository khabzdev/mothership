import type { PreflightInfo } from "@spaceship/protocol";

/** How long a check may run before it counts as NO-GO. */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** The timeouts a check can be set to: 1, 5, 10 or 20 minutes. */
export const TIMEOUTS_MS = [60_000, 300_000, 600_000, 1_200_000];

const MAX_COMMAND = 500;

const asRecord = (input: unknown) =>
  (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

function requiredId(o: Record<string, unknown>, key: string): string {
  const value = typeof o[key] === "string" ? o[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function parseDeckInput(input: unknown): { deckId: string } {
  return { deckId: requiredId(asRecord(input), "deckId") };
}

export function parseArmInput(input: unknown): { deckId: string; armed: boolean } {
  const o = asRecord(input);
  if (typeof o.armed !== "boolean") throw new Error("armed must be true or false");
  return { deckId: requiredId(o, "deckId"), armed: o.armed };
}

export interface CheckPatch {
  deckId: string;
  checkId: string;
  command?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export function parseCheckPatch(input: unknown): CheckPatch {
  const o = asRecord(input);
  const patch: CheckPatch = { deckId: requiredId(o, "deckId"), checkId: requiredId(o, "checkId") };
  if (o.command !== undefined) {
    const command = typeof o.command === "string" ? o.command.trim() : "";
    if (!command || command.length > MAX_COMMAND) {
      throw new Error(`A command is 1–${MAX_COMMAND} characters`);
    }
    patch.command = command;
  }
  if (o.enabled !== undefined) {
    if (typeof o.enabled !== "boolean") throw new Error("enabled must be true or false");
    patch.enabled = o.enabled;
  }
  if (o.timeoutMs !== undefined) {
    if (typeof o.timeoutMs !== "number" || !TIMEOUTS_MS.includes(o.timeoutMs)) {
      throw new Error("timeoutMs must be 1, 5, 10 or 20 minutes");
    }
    patch.timeoutMs = o.timeoutMs;
  }
  return patch;
}

const ID = /^[\w-]+$/;

function pathSafeId(o: Record<string, unknown>, key: string): string {
  const value = typeof o[key] === "string" ? o[key] : "";
  if (!ID.test(value)) throw new Error(`${key} is not valid`);
  return value;
}

/** Ids end up in a file path, so only letters, digits, `_` and `-` get through. */
export function parseLogInput(input: unknown): { preflightId: string; checkId: string } {
  const o = asRecord(input);
  return { preflightId: pathSafeId(o, "preflightId"), checkId: pathSafeId(o, "checkId") };
}

/** The chip on a crew row: nothing until a pre-flight has run this flight. */
export function preflightChip(
  info?: PreflightInfo,
): { label: string; tone: "warning" | "success" | "error" } | null {
  if (!info) return null;
  if (info.state === "running") return { label: "Pre-flight…", tone: "warning" };
  if (info.state === "go") return { label: "GO", tone: "success" };
  if (info.state === "nogo") {
    return { label: `NO-GO · fuel ${info.fuel}/${info.maxFuel}`, tone: "error" };
  }
  return null;
}
