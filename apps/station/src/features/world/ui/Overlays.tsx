import { Button, Checkbox, ClipboardText } from "@cloudflare/kumo";
import {
  GitBranchIcon,
  GitPullRequestIcon,
  LinkSquare02Icon,
  Message01Icon,
  Rocket01Icon,
  Target02Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import type { ConsoleLabel, CrewInfo } from "@mothership/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChangesPanel } from "../../changes/ui/ChangesPanel";
import { BoardWindow } from "../../github/ui/BoardWindow";
import { hireMutation, promptMutation } from "../../crew/queries";
import { CONSOLES } from "../layout";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { useWorld } from "../store";
import { LabelWindow } from "./LabelWindow";
import { Lift } from "./Lift";
import { Modal } from "./Modal";
import { SendHomeWindow } from "./SendHome";
import { StatusBadge } from "./StatusBadge";
import { TerminalDrawer } from "./TerminalDrawer";
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
      icon={UserAdd01Icon}
      title={withTask ? `New task at ${label}` : `Hire crew at ${label}`}
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
        <Checkbox
          className="game-form__check"
          label={
            <span className="with-icon">
              <Icon icon={GitBranchIcon} /> Work in its own git worktree &amp; branch
            </span>
          }
          checked={worktree}
          onCheckedChange={(checked) => {
            setWorktree(checked);
            try {
              localStorage.setItem(WORKTREE_PREF, checked ? "1" : "0");
            } catch {
              // preference only
            }
          }}
        />
        <ErrorNote error={hire.error} />
      </TaskBox>
    </Modal>
  );
}

function PromptWindow({ member }: { member: CrewInfo }) {
  const close = useWorld((s) => s.close);
  const prompt = useMutation(promptMutation());
  return (
    <Modal
      icon={Message01Icon}
      title={`Prompt ${member.name}`}
      subtitle={<StatusBadge crew={member} />}
    >
      <TaskBox
        placeholder={`Tell ${member.name} what to do next`}
        required
        busy={prompt.isPending}
        submitLabel="Send"
        onSubmit={(text) => prompt.mutate({ crewId: member.id, text }, { onSuccess: close })}
      >
        <ErrorNote error={prompt.error} />
      </TaskBox>
    </Modal>
  );
}

function ChangesWindow({ member }: { member: CrewInfo }) {
  const open = useWorld((s) => s.open);
  return (
    <Modal
      wide
      icon={GitBranchIcon}
      title={`${member.name} · changes`}
      subtitle={<StatusBadge crew={member} />}
    >
      <ChangesPanel
        crewId={member.id}
        task={member.task}
        onTerminal={() => open({ kind: "terminal", crewId: member.id })}
      />
    </Modal>
  );
}

function PrWindow({ member }: { member: CrewInfo }) {
  const url = member.prUrl ?? "";
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  return (
    <Modal
      icon={GitPullRequestIcon}
      title={`${member.name}'s pull request${number ? ` #${number}` : ""}`}
      subtitle={
        <span className="with-icon">
          <Icon icon={GitBranchIcon} /> {member.branch}
        </span>
      }
    >
      <ClipboardText text={url} />
      <footer className="modal__foot">
        <span />
        <Button
          variant="primary"
          icon={<Icon icon={LinkSquare02Icon} />}
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          Open on GitHub
        </Button>
      </footer>
    </Modal>
  );
}

/** Whichever game window is open. */
export function Overlays({
  deckId,
  crew,
  labels,
}: {
  deckId: string;
  crew: CrewInfo[];
  labels: ConsoleLabel[];
}) {
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
        <TerminalDrawer member={member} />
      );
    }
    case "changes": {
      const member = crew.find((c) => c.id === overlay.crewId);
      return member ? <ChangesWindow member={member} /> : null;
    }
    case "pr": {
      const member = crew.find((c) => c.id === overlay.crewId);
      return member?.prUrl ? <PrWindow member={member} /> : null;
    }
    case "sendHome": {
      const member = crew.find((c) => c.id === overlay.crewId);
      return member ? <SendHomeWindow member={member} /> : null;
    }
    case "label":
      return (
        <LabelWindow
          deckId={deckId}
          consoleId={overlay.consoleId}
          label={labels.find((l) => l.consoleId === overlay.consoleId)}
        />
      );
    case "board":
      return (
        <Modal
          wide
          icon={overlay.board === "mission" ? Target02Icon : Rocket01Icon}
          title={overlay.board === "mission" ? "Mission board" : "Launch board"}
          subtitle={
            overlay.board === "mission"
              ? "The repo's GitHub issues. Hand one to crew and it moves to In progress."
              : "The repo's pull requests. Launching one merges it."
          }
        >
          <BoardWindow deckId={deckId} board={overlay.board} initial={overlay.open} />
        </Modal>
      );
    case "lift":
      return <Lift fromLift={overlay.fromLift} />;
  }
}
