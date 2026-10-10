import type { CrewInfo } from "@mothership/protocol";
import { useEffect } from "react";
import { openShell, resumeCrew, sendHomeCrew } from "../crew/crew.functions";
import { giveIssue, handIssue } from "../github/github.functions";
import { openCrewPr } from "../pr/pr.functions";
import { notify, toasts } from "../../shared/ui/toasts";
import { canCancel } from "./ship";
import { gameKeysEnabled, useWorld } from "./store";

/** Send a crew member without a worktree of its own home at once (agent-office's X). */
export function sendHomeNow(member: CrewInfo): void {
  const { say } = useWorld.getState();
  sendHomeCrew({ data: { crewId: member.id, worktree: "keep" } }).then(
    () => say(`${member.name} is heading for the airlock`),
    (error: Error) => say(error.message, "error"),
  );
}

/** R: wake an asleep crew member in its own session, or restart its shell. */
function resume(member: CrewInfo): void {
  const { say } = useWorld.getState();
  if (member.status !== "asleep") return say(`${member.name} is already running`);
  say(member.kind === "shell" ? "Restarting the shell" : `Waking ${member.name} up`);
  resumeCrew({ data: { crewId: member.id } }).catch((error: Error) => say(error.message, "error"));
}

/** B: a shell at an empty console, with its terminal open. */
function shell(deckId: string, consoleId: number): void {
  const { say, open } = useWorld.getState();
  openShell({ data: { deckId, consoleId, task: "", worktree: false } }).then(
    (member) => open({ kind: "terminal", crewId: member.id }),
    (error: Error) => say(error.message, "error"),
  );
}

/** O: push the branch and open a pull request, or show the one it has (agent-office's O). */
function pullRequest(member: CrewInfo): void {
  const { say, open } = useWorld.getState();
  if (member.prUrl) return open({ kind: "pr", crewId: member.id });
  if (!member.branch)
    return say(`${member.name} has no branch of its own: hire it with its own worktree`);
  const pushing = notify(`Checking pre-flight, then pushing ${member.branch}…`);
  openCrewPr({ data: { crewId: member.id } }).then(
    (result) => {
      // Whatever happened, "pushing" is over; with the launch check asking, nothing was pushed.
      toasts.close(pushing);
      if ("needsConfirm" in result) {
        return open({ kind: "launchCheck", crewId: member.id, reason: result.needsConfirm });
      }
      say(`${member.name}'s pull request is open`, "success");
      open({ kind: "pr", crewId: member.id });
    },
    (error: Error) => {
      toasts.close(pushing);
      say(error.message, "error");
    },
  );
}

/**
 * E at a console with an issue's card in your hands (agent-office): an empty console hires crew
 * for it, a crew member already there is handed it.
 */
function deliver(deckId: string, consoleId: number, member: CrewInfo | undefined): void {
  const { carrying, carry, say } = useWorld.getState();
  if (!carrying) return;
  const { number } = carrying;
  carry(null);
  const done = (claimed: boolean, who: string) =>
    say(`${who} took #${number}${claimed ? "" : " (couldn't assign it on GitHub)"}`, "success");
  const failed = (error: Error) => {
    carry(carrying);
    say(error.message, "error");
  };
  if (!member) {
    handIssue({ data: { deckId, number, consoleId } }).then(
      ({ member: hired, claimed }) => done(claimed, hired.name),
      failed,
    );
  } else if (member.kind === "agent") {
    giveIssue({ data: { deckId, number, crewId: member.id } }).then(
      ({ claimed }) => done(claimed, member.name),
      failed,
    );
  } else {
    carry(carrying);
    say(`${member.name} is a shell: take #${number} to a crew member or an empty console`);
  }
}

/** The keys at a console: agent-office's desk keys. */
export function useConsoleKeys(deckId: string, crew: CrewInfo[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape calls your ship's take-off off while it's still rumbling on the pad.
      if (e.key === "Escape") {
        const { flight, cancelFlight } = useWorld.getState();
        if (canCancel(flight, Date.now())) {
          e.preventDefault();
          return cancelFlight();
        }
      }
      if (!gameKeysEnabled(e)) return;
      const { consoleId, atShip, atFlightControl, atBoard, open, carrying, carry, say } =
        useWorld.getState();
      // / searches every terminal on the deck, wherever you are.
      if (e.key === "/") {
        e.preventDefault();
        return open({ kind: "search" });
      }
      // Q puts the card you're carrying back on the board.
      if (carrying && e.code === "KeyQ") {
        e.preventDefault();
        carry(null);
        return say(`#${carrying.number} is back on the Mission board`);
      }
      if (atBoard && consoleId === null && e.code === "KeyE") {
        e.preventDefault();
        return open({ kind: "board", board: atBoard });
      }
      if (atShip && e.code === "KeyE") {
        e.preventDefault();
        return open({ kind: "flight", fromShip: true });
      }
      if (atFlightControl && consoleId === null && e.code === "KeyE") {
        e.preventDefault();
        return open({ kind: "flightControl" });
      }
      if (consoleId === null) return;
      const member = crew.find((c) => c.consoleId === consoleId);
      if (carrying && e.code === "KeyE") {
        e.preventDefault();
        return deliver(deckId, consoleId, member);
      }
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
        case "KeyG":
          if (!member || member.kind === "shell") return;
          e.preventDefault();
          open({ kind: "preflight", crewId: member.id });
          return;
        case "KeyL":
          e.preventDefault();
          open({ kind: "label", consoleId });
          return;
        case "KeyR":
          if (!member) return;
          e.preventDefault();
          resume(member);
          return;
        case "KeyB":
          if (member) {
            if (!member.brief) return;
            e.preventDefault();
            open({ kind: "brief", crewId: member.id });
            return;
          }
          e.preventDefault();
          shell(deckId, consoleId);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deckId, crew]);
}
