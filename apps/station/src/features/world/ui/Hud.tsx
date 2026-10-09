import type { CrewInfo } from "@mothership/protocol";
import { useSuspenseQuery } from "@tanstack/react-query";
import { crewBlocker } from "../../../app/diagnostics";
import { diagnosticsQuery } from "../../../app/queries";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import type { Deck } from "../../decks/model";
import { CONSOLES } from "../layout";
import { useWorld } from "../store";

function Key({ k, label }: { k: string; label: string }) {
  return (
    <span className="hint__key">
      <kbd>{k}</kbd> {label}
    </span>
  );
}

/** What you're facing and what you can do there (agent-office's hint bar). */
export function HintBar({ crew }: { crew: CrewInfo[] }) {
  const consoleId = useWorld((s) => s.consoleId);
  if (consoleId === null) {
    return (
      <div className="hint">
        <Key k="WASD" label="Walk" />
        <Key k="Shift" label="Run" />
        <Key k="Drag" label="Look" />
      </div>
    );
  }
  const label = CONSOLES[consoleId]!.label;
  const member = crew.find((c) => c.consoleId === consoleId);
  return (
    <div className="hint" data-active>
      {member ? (
        <>
          <span className="hint__what">
            {label} · <strong>{member.name}</strong>
          </span>
          <Key k="E" label="Open terminal" />
          <Key k="P" label={`Prompt ${member.name}`} />
          {member.status === "asleep" && (
            <Key k="R" label={member.kind === "shell" ? "Restart" : "Resume"} />
          )}
          <Key k="X" label="Send home" />
        </>
      ) : (
        <>
          <span className="hint__what">{label} · empty</span>
          <Key k="E" label="Hire crew" />
          <Key k="P" label="Hire with a task" />
          <Key k="B" label="Shell" />
        </>
      )}
    </div>
  );
}

/** Deck name (opens the lift), comms and a crew-offline warning. */
export function TopBar({ deck, crew }: { deck: Deck; crew: CrewInfo[] }) {
  const open = useWorld((s) => s.open);
  const { state } = useRealtime();
  const { data: diagnostics } = useSuspenseQuery(diagnosticsQuery);
  const blocker = crewBlocker(diagnostics);
  const waiting = crew.filter((c) => c.status === "needs_input").length;
  const done = crew.filter((c) => c.status === "done").length;
  return (
    <>
      <div className="topbar">
        <button
          type="button"
          className="topbar__deck"
          onClick={() => open({ kind: "lift" })}
          title="Ride the lift"
        >
          <span className="eyebrow">Deck</span>
          <span className="topbar__name">{deck.name}</span>
        </button>
        <div className="topbar__right">
          {(waiting > 0 || done > 0) && (
            <span className="readout topbar__count">
              {waiting > 0 && `🙋 ${waiting} need you`}
              {waiting > 0 && done > 0 && " · "}
              {done > 0 && `✅ ${done} done`}
            </span>
          )}
          <span className="readout">
            <span
              className="lamp"
              data-tone={state === "open" ? "go" : state === "connecting" ? "check" : "alert"}
            />
            Comms {state}
          </span>
        </div>
      </div>
      {blocker && (
        <p role="alert" className="banner banner--alert">
          {blocker}
        </p>
      )}
    </>
  );
}
