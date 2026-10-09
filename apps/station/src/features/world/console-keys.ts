import type { CrewInfo } from "@mothership/protocol";
import { useEffect } from "react";
import { sendHomeCrew } from "../crew/crew.functions";
import { gameKeysEnabled, useWorld } from "./store";

/** Send a crew member without a worktree of its own home at once (agent-office's X). */
export function sendHomeNow(member: CrewInfo): void {
  const { say } = useWorld.getState();
  sendHomeCrew({ data: { crewId: member.id, worktree: "keep" } }).then(
    () => say(`👋 ${member.name} is heading for the airlock`),
    (error: Error) => say(`⚠️ ${error.message}`),
  );
}

/** The keys at a console: agent-office's desk keys. */
export function useConsoleKeys(crew: CrewInfo[]): void {
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crew]);
}
