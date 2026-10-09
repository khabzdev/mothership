import type { NewCriterion, NewMission } from "./repo.server";

export type { MissionRecord } from "./repo.server";

const MAX_GOAL = 4000;
const MAX_CRITERIA = 20;
const MAX_FIELD = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseCreateMissionInput(input: unknown): NewMission {
  if (!isObject(input)) throw new Error("Expected a mission brief");
  const deckId = text(input.deckId);
  if (!deckId) throw new Error("deckId is required");
  const goal = text(input.goal);
  if (!goal) throw new Error("Goal is required");
  if (goal.length > MAX_GOAL) throw new Error("Goal is too long");

  const raw = Array.isArray(input.criteria) ? input.criteria : [];
  if (raw.length === 0) throw new Error("Add at least one acceptance criterion");
  if (raw.length > MAX_CRITERIA) throw new Error(`At most ${MAX_CRITERIA} criteria`);
  const criteria = raw.map((c: unknown, i): NewCriterion => {
    const n = i + 1;
    if (isObject(c) && c.kind === "command") {
      const command = text(c.command);
      if (!command || command.length > MAX_FIELD) throw new Error(`Criterion ${n} needs a command`);
      return { kind: "command", command };
    }
    if (isObject(c) && c.kind === "manual") {
      const label = text(c.label);
      if (!label || label.length > MAX_FIELD) throw new Error(`Criterion ${n} needs a label`);
      return { kind: "manual", label };
    }
    throw new Error(`Criterion ${n} must be a command or a manual check`);
  });

  const { maxAttempts } = input;
  if (
    maxAttempts !== undefined &&
    (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > 10)
  ) {
    throw new Error("maxAttempts must be a whole number from 1 to 10");
  }
  return {
    deckId,
    goal,
    criteria,
    ...(maxAttempts !== undefined && { maxAttempts: maxAttempts as number }),
  };
}

export function parseMissionIdInput(input: unknown): { missionId: string } {
  const missionId = isObject(input) ? text(input.missionId) : "";
  if (!missionId) throw new Error("missionId is required");
  return { missionId };
}

export function parseDeckIdInput(input: unknown): { deckId: string } {
  const deckId = isObject(input) ? text(input.deckId) : "";
  if (!deckId) throw new Error("deckId is required");
  return { deckId };
}
