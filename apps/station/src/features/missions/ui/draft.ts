import type { NewMission } from "../repo.server";

export type DraftKind = "command" | "manual";

export interface DraftCriterion {
  key: string;
  kind: DraftKind;
  text: string;
}

export interface Draft {
  goal: string;
  maxAttempts: number;
  criteria: DraftCriterion[];
}

export type DraftAction =
  | { type: "setGoal"; goal: string }
  | { type: "setFuel"; maxAttempts: number }
  | { type: "addCriterion" }
  | { type: "removeCriterion"; key: string }
  | { type: "editCriterion"; key: string; text: string }
  | { type: "setKind"; key: string; kind: DraftKind }
  | { type: "reset" };

let nextKey = 0;
const criterion = (): DraftCriterion => ({ key: `c${nextKey++}`, kind: "command", text: "" });

export function emptyDraft(): Draft {
  return { goal: "", maxAttempts: 3, criteria: [criterion()] };
}

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  const update = (key: string, patch: Partial<DraftCriterion>) => ({
    ...draft,
    criteria: draft.criteria.map((c) => (c.key === key ? { ...c, ...patch } : c)),
  });
  switch (action.type) {
    case "setGoal":
      return { ...draft, goal: action.goal };
    case "setFuel":
      return { ...draft, maxAttempts: Math.min(10, Math.max(1, Math.round(action.maxAttempts))) };
    case "addCriterion":
      return { ...draft, criteria: [...draft.criteria, criterion()] };
    case "removeCriterion":
      return draft.criteria.length > 1
        ? { ...draft, criteria: draft.criteria.filter((c) => c.key !== action.key) }
        : draft;
    case "editCriterion":
      return update(action.key, { text: action.text });
    case "setKind":
      return update(action.key, { kind: action.kind });
    case "reset":
      return emptyDraft();
  }
}

/** The brief to send to the server; blank criteria are dropped (the server validates the rest). */
export function toNewMission(draft: Draft, deckId: string): NewMission {
  return {
    deckId,
    goal: draft.goal.trim(),
    maxAttempts: draft.maxAttempts,
    criteria: draft.criteria
      .filter((c) => c.text.trim())
      .map((c) =>
        c.kind === "command"
          ? { kind: "command", command: c.text.trim() }
          : { kind: "manual", label: c.text.trim() },
      ),
  };
}
