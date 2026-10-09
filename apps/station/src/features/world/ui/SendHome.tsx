import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { WorktreeChoice } from "../../crew/model";
import { sendHomeMutation, worktreeQuery } from "../../crew/queries";
import { CONSOLES } from "../layout";
import { useWorld } from "../store";
import { Modal } from "./Modal";

const LABELS: Record<WorktreeChoice, string> = {
  delete: "Send home & delete both",
  remove: "Send home & delete worktree",
  keep: "Send home",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * agent-office's send-home dialog for a crew member with its own worktree: what becomes of the
 * worktree and its branch. Opens on "keep" while the worktree is checked, then suggests deleting
 * both when nothing would be lost.
 */
export function SendHomeWindow({ member }: { member: CrewInfo }) {
  const { close, say } = useWorld.getState();
  const state = useQuery(worktreeQuery(member.id));
  const sendHome = useMutation(sendHomeMutation());
  const [choice, setChoice] = useState<WorktreeChoice>("keep");
  const [touched, setTouched] = useState(false);
  const branch = member.branch ?? "its branch";
  const where = CONSOLES[member.consoleId]?.label ?? "its console";
  const s = state.data;
  const atRisk = !!s && !s.missing && (s.dirty > 0 || s.unpushed > 0);

  useEffect(() => {
    if (s && !touched) setChoice(atRisk ? "keep" : "delete");
  }, [s, atRisk, touched]);

  const choices: [WorktreeChoice, string, string][] = [
    ["delete", "Delete the worktree and its branch", `Removes the worktree and ${branch}.`],
    [
      "remove",
      "Delete the worktree, keep the branch",
      `${branch} stays for a pull request or a later checkout.`,
    ],
    ["keep", "Keep both", "Leaves everything as it is."],
  ];

  return (
    <Modal
      title={`Send ${member.name} home?`}
      subtitle={`This stops the session at ${where} and frees the console. ${member.name} worked in its own worktree on 🌿 ${branch}:`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendHome.mutate(
            { crewId: member.id, worktree: choice },
            {
              onSuccess: () => {
                close();
                say(`👋 ${member.name} is heading for the airlock`);
              },
            },
          );
        }}
      >
        <div className="choices" role="radiogroup">
          {choices.map(([value, title, sub]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="worktree"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setTouched(true);
                  setChoice(value);
                }}
              />
              <span>
                {title}
                <small>{sub}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="wt-status" data-risk={atRisk || undefined}>
          {state.isPending
            ? `Checking what ${branch} holds…`
            : state.error
              ? `⚠️ Couldn't check the worktree: ${state.error.message}`
              : !s || s.missing
                ? "🌿 Its worktree is already gone."
                : atRisk
                  ? `⚠️ ${[s.dirty && `${plural(s.dirty, "file")} with uncommitted changes`, s.unpushed && `${plural(s.unpushed, "commit")} on no remote`].filter(Boolean).join(" and ")}: deleting loses them.`
                  : "✅ Nothing would be lost: everything is committed and pushed."}
        </p>
        {sendHome.error && (
          <p role="alert" className="error">
            {sendHome.error.message}
          </p>
        )}
        <footer className="modal__foot">
          <button type="button" className="button button--ghost" onClick={close}>
            Never mind
          </button>
          <button type="submit" className="button button--danger" disabled={sendHome.isPending}>
            {sendHome.isPending ? "Sending home…" : LABELS[choice]}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
