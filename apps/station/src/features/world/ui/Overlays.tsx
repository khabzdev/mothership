import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TerminalPanel } from "../../crew/ui/TerminalPanel";
import { hireMutation, promptMutation } from "../../crew/queries";
import { CONSOLES } from "../layout";
import { STATUS_CHIPS } from "../scene/status";
import { useWorld } from "../store";
import { Lift } from "./Lift";
import { Modal } from "./Modal";
import { TaskBox } from "./TaskBox";

const WORKTREE_PREF = "mothership.worktree";

function readWorktreePref(): boolean {
  try {
    return localStorage.getItem(WORKTREE_PREF) === "1";
  } catch {
    return false;
  }
}

function HireWindow({
  deckId,
  consoleId,
  withTask,
}: {
  deckId: string;
  consoleId: number;
  withTask: boolean;
}) {
  const queryClient = useQueryClient();
  const close = useWorld((s) => s.close);
  const hire = useMutation(hireMutation(queryClient));
  const [worktree, setWorktree] = useState(readWorktreePref);
  const label = CONSOLES[consoleId]?.label ?? `Console ${consoleId + 1}`;

  return (
    <Modal
      title={withTask ? `✨ New task at ${label}` : `✨ Hire crew at ${label}`}
      subtitle={
        withTask
          ? "Claude Code will start on it right away."
          : "Give it a first task, or leave it empty."
      }
    >
      <TaskBox
        placeholder={withTask ? "What should it do?" : "First task (optional)"}
        required={withTask}
        busy={hire.isPending}
        submitLabel="Hire & start"
        onSubmit={(task) =>
          hire.mutate({ deckId, consoleId, task, worktree }, { onSuccess: close })
        }
      >
        <label className="check">
          <input
            type="checkbox"
            checked={worktree}
            onChange={(e) => {
              setWorktree(e.target.checked);
              try {
                localStorage.setItem(WORKTREE_PREF, e.target.checked ? "1" : "0");
              } catch {
                // preference only
              }
            }}
          />
          🌿 Work in its own git worktree &amp; branch
        </label>
        {hire.error && (
          <p role="alert" className="error">
            {hire.error.message}
          </p>
        )}
      </TaskBox>
    </Modal>
  );
}

function PromptWindow({ member }: { member: CrewInfo }) {
  const close = useWorld((s) => s.close);
  const prompt = useMutation(promptMutation());
  return (
    <Modal title={`💬 Prompt ${member.name}`} subtitle={STATUS_CHIPS[member.status]}>
      <TaskBox
        placeholder={`Tell ${member.name} what to do next`}
        required
        busy={prompt.isPending}
        submitLabel="Send"
        onSubmit={(text) => prompt.mutate({ crewId: member.id, text }, { onSuccess: close })}
      >
        {prompt.error && (
          <p role="alert" className="error">
            {prompt.error.message}
          </p>
        )}
      </TaskBox>
    </Modal>
  );
}

function TerminalWindow({ member }: { member: CrewInfo }) {
  return (
    <Modal
      wide
      title={`${member.name} · Claude Code`}
      subtitle={`${STATUS_CHIPS[member.status]}${member.task ? ` · ${member.task.split("\n")[0]}` : ""}`}
    >
      <TerminalPanel crewId={member.id} />
    </Modal>
  );
}

/** Whichever game window is open. */
export function Overlays({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const overlay = useWorld((s) => s.overlay);
  if (!overlay) return null;
  switch (overlay.kind) {
    case "hire":
      return (
        <HireWindow deckId={deckId} consoleId={overlay.consoleId} withTask={overlay.withTask} />
      );
    case "prompt":
    case "terminal": {
      const member = crew.find((c) => c.id === overlay.crewId);
      if (!member) return null;
      return overlay.kind === "prompt" ? (
        <PromptWindow member={member} />
      ) : (
        <TerminalWindow member={member} />
      );
    }
    case "lift":
      return <Lift />;
  }
}
