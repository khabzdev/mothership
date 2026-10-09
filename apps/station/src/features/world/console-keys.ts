import type { CrewInfo } from "@mothership/protocol";
import { useEffect } from "react";
import { openShell, resumeCrew, sendHomeCrew } from "../crew/crew.functions";
import { openCrewPr } from "../pr/pr.functions";
import { gameKeysEnabled, useWorld } from "./store";

/** Send a crew member without a worktree of its own home at once (agent-office's X). */
export function sendHomeNow(member: CrewInfo): void {
  const { say } = useWorld.getState();
  sendHomeCrew({ data: { crewId: member.id, worktree: "keep" } }).then(
    () => say(`👋 ${member.name} is heading for the airlock`),
    (error: Error) => say(`⚠️ ${error.message}`),
  );
}

/** R: wake an asleep crew member in its own session, or restart its shell. */
function resume(member: CrewInfo): void {
  const { say } = useWorld.getState();
  if (member.status !== "asleep") return say(`${member.name} is already running`);
  say(member.kind === "shell" ? "🐚 Restarting the shell" : `⏰ Waking ${member.name} up`);
  resumeCrew({ data: { crewId: member.id } }).catch((error: Error) => say(`⚠️ ${error.message}`));
}

/** B: a shell at an empty console, with its terminal open. */
function shell(deckId: string, consoleId: number): void {
  const { say, open } = useWorld.getState();
  openShell({ data: { deckId, consoleId, task: "", worktree: false } }).then(
    (member) => open({ kind: "terminal", crewId: member.id }),
    (error: Error) => say(`⚠️ ${error.message}`),
  );
}

/** O: push the branch and open a pull request, or show the one it has (agent-office's O). */
function pullRequest(member: CrewInfo): void {
  const { say, open } = useWorld.getState();
  if (member.prUrl) return open({ kind: "pr", crewId: member.id });
  if (!member.branch)
    return say(`${member.name} has no branch of its own: hire with 🌿 own worktree`);
  say(`🚀 Pushing ${member.branch} and opening a pull request…`);
  openCrewPr({ data: { crewId: member.id } }).then(
    () => {
      say(`🚀 ${member.name}'s pull request is open`);
      open({ kind: "pr", crewId: member.id });
    },
    (error: Error) => say(`⚠️ ${error.message}`),
  );
}

/** The keys at a console: agent-office's desk keys. */
export function useConsoleKeys(deckId: string, crew: CrewInfo[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!gameKeysEnabled(e)) return;
      const { consoleId, open } = useWorld.getState();
      if (consoleId === null) return;
      const member = crew.find((c) => c.consoleId === consoleId);
      switch (e.code) {
        case "KeyE":
          e.preventDefault();
          open(
            member
              ? { kind: "terminal", crewId: member.id }
              : { kind: "hire", consoleId, withTask: false },
          );
          return;
        case "KeyP":
          e.preventDefault();
          open(
            member
              ? { kind: "prompt", crewId: member.id }
              : { kind: "hire", consoleId, withTask: true },
          );
          return;
        case "KeyX":
          if (!member) return;
          e.preventDefault();
          // With its own worktree it asks what becomes of it first.
          if (member.branch) open({ kind: "sendHome", crewId: member.id });
          else sendHomeNow(member);
          return;
        case "KeyC":
          if (!member) return;
          e.preventDefault();
          open({ kind: "changes", crewId: member.id });
          return;
        case "KeyO":
          if (!member || member.kind === "shell") return;
          e.preventDefault();
          pullRequest(member);
          return;
        case "KeyR":
          if (!member) return;
          e.preventDefault();
          resume(member);
          return;
        case "KeyB":
          if (member) return;
          e.preventDefault();
          shell(deckId, consoleId);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deckId, crew]);
}
