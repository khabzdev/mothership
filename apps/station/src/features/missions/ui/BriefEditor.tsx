import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReducer, type FormEvent } from "react";
import { createMissionMutation, launchMissionMutation } from "../queries";
import { draftReducer, emptyDraft, toNewMission } from "./draft";

/** Write a mission brief: goal, acceptance criteria and fuel. */
export function BriefEditor({ deckId }: { deckId: string }) {
  const queryClient = useQueryClient();
  const [draft, dispatch] = useReducer(draftReducer, undefined, emptyDraft);
  const create = useMutation(createMissionMutation(queryClient));
  const launch = useMutation(launchMissionMutation(queryClient));
  const busy = create.isPending || launch.isPending;
  const error = create.error ?? launch.error;

  const submit = (andLaunch: boolean) => (event?: FormEvent) => {
    event?.preventDefault();
    create.mutate(toNewMission(draft, deckId), {
      onSuccess: (record) => {
        dispatch({ type: "reset" });
        if (andLaunch) launch.mutate(record.id);
      },
    });
  };

  return (
    <form className="brief" onSubmit={submit(false)} aria-label="Mission brief">
      <h2 className="stencil">New mission</h2>

      <label className="field">
        <span className="field__label">Goal</span>
        <textarea
          name="goal"
          rows={3}
          value={draft.goal}
          onChange={(e) => dispatch({ type: "setGoal", goal: e.target.value })}
          placeholder="What should the Engineer build?"
        />
      </label>

      <fieldset className="field">
        <legend className="field__label">Acceptance criteria</legend>
        <ol className="brief__criteria">
          {draft.criteria.map((c, i) => (
            <li key={c.key}>
              <div className="segmented" role="radiogroup" aria-label={`Criterion ${i + 1} kind`}>
                {(["command", "manual"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={c.kind === kind}
                    onClick={() => dispatch({ type: "setKind", key: c.key, kind })}
                  >
                    {kind === "command" ? "Command" : "Manual"}
                  </button>
                ))}
              </div>
              <input
                aria-label={`Criterion ${i + 1}`}
                value={c.text}
                spellCheck={c.kind === "manual"}
                className={c.kind === "command" ? "mono" : undefined}
                placeholder={c.kind === "command" ? "vp test" : "Toggle looks right"}
                onChange={(e) =>
                  dispatch({ type: "editCriterion", key: c.key, text: e.target.value })
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove criterion ${i + 1}`}
                disabled={draft.criteria.length === 1}
                onClick={() => dispatch({ type: "removeCriterion", key: c.key })}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => dispatch({ type: "addCriterion" })}
        >
          + Criterion
        </button>
      </fieldset>

      <label className="field field--inline">
        <span className="field__label">Fuel</span>
        <input
          type="number"
          name="maxAttempts"
          min={1}
          max={10}
          value={draft.maxAttempts}
          onChange={(e) => dispatch({ type: "setFuel", maxAttempts: Number(e.target.value) })}
        />
        <span className="muted">attempts before red alert</span>
      </label>

      {error && (
        <p role="alert" className="error">
          {error.message}
        </p>
      )}

      <div className="brief__actions">
        <button type="submit" className="button button--ghost" disabled={busy}>
          Save brief
        </button>
        <button type="button" className="button" disabled={busy} onClick={submit(true)}>
          {busy ? "Working…" : "Create & launch"}
        </button>
      </div>
    </form>
  );
}
