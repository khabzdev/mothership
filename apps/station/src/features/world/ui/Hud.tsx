import { Badge, Banner, Surface } from "@cloudflare/kumo";
import {
  Alert02Icon,
  AirplaneTakeOff01Icon,
  CheckmarkCircle02Icon,
  HandGrabIcon,
  Notebook01Icon,
  Notification03Icon,
  Rocket01Icon,
  SpaceshipIcon,
  Target02Icon,
  TaskDaily01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../../shared/ui/Icon";
import type { ConsoleLabel, CrewInfo } from "@spaceship/protocol";
import { useSuspenseQuery } from "@tanstack/react-query";
import { crewBlocker } from "../../../app/diagnostics";
import { diagnosticsQuery } from "../../../app/queries";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import type { Deck } from "../../decks/model";
import type { CSSProperties } from "react";
import { CONSOLES } from "../layout";
import { paintFor } from "../paint";
import { useWorld } from "../store";

function Key({ k, label }: { k: string; label: string }) {
  return (
    <span className="hint__key">
      <kbd>{k}</kbd> {label}
    </span>
  );
}

/** Each board's icon, what it is, and what E does there. */
const BOARD_HINTS = {
  mission: [Target02Icon, "Mission board · issues", "Read the board"],
  launch: [Rocket01Icon, "Launch board · pull requests", "Read the board"],
  queue: [TaskDaily01Icon, "Task queue", "Read the board"],
  log: [Notebook01Icon, "Captain's log", "Read the log"],
} as const;

/** What you're facing and what you can do there (agent-office's hint bar). */
export function HintBar({
  crew,
  labels,
  lessonsPending,
}: {
  crew: CrewInfo[];
  labels: ConsoleLabel[];
  /** Lessons waiting at Flight Control's Debrief. */
  lessonsPending: number;
}) {
  const consoleId = useWorld((s) => s.consoleId);
  const atShip = useWorld((s) => s.atShip);
  const aboard = useWorld((s) => s.flight !== null || s.arriving);
  const atFlightControl = useWorld((s) => s.atFlightControl);
  const atBoard = useWorld((s) => s.atBoard);
  const carrying = useWorld((s) => s.carrying);
  if (carrying) {
    const member = crew.find((c) => c.consoleId === consoleId);
    return (
      <div className="hint" data-active>
        <span className="hint__what with-icon">
          <Icon icon={HandGrabIcon} /> Carrying #{carrying.number}
        </span>
        {consoleId !== null && member?.kind !== "shell" && (
          <Key k="E" label={member ? `Hand it to ${member.name}` : "Hire crew for it"} />
        )}
        <Key k="Q" label="Put it back" />
      </div>
    );
  }
  if (atBoard && consoleId === null) {
    return (
      <div className="hint" data-active>
        <span className="hint__what with-icon">
          <Icon icon={BOARD_HINTS[atBoard][0]} />
          {BOARD_HINTS[atBoard][1]}
        </span>
        <Key k="E" label={BOARD_HINTS[atBoard][2]} />
      </div>
    );
  }
  if (atShip && !aboard && consoleId === null) {
    return (
      <div className="hint" data-active>
        <span className="hint__what with-icon">
          <Icon icon={SpaceshipIcon} /> Your ship
        </span>
        <Key k="E" label="Fly to another deck" />
      </div>
    );
  }
  if (atFlightControl && consoleId === null) {
    return (
      <div className="hint" data-active>
        <span className="hint__what with-icon">
          <Icon icon={AirplaneTakeOff01Icon} /> Flight Control
        </span>
        <Key k="E" label="Set the pre-flight checks" />
        <Key k="L" label={lessonsPending ? `Debrief · ${lessonsPending} new` : "Debrief"} />
      </div>
    );
  }
  if (consoleId === null) {
    return (
      <div className="hint">
        <Key k="WASD" label="Walk" />
        <Key k="Shift" label="Run" />
        <Key k="Drag" label="Look" />
        <Key k="⌘K" label="Find" />
        <Key k="/" label="Search terminals" />
      </div>
    );
  }
  const sign = labels.find((l) => l.consoleId === consoleId)?.text;
  const label = `${CONSOLES[consoleId]!.label}${sign ? ` · ${sign}` : ""}`;
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
          <Key k="C" label="Changes" />
          {member.kind === "agent" && <Key k="G" label="Pre-flight" />}
          {member.brief && <Key k="B" label="Brief" />}
          {member.kind === "agent" && member.inspection && <Key k="I" label="Inspection" />}
          {member.branch && <Key k="O" label={member.prUrl ? "See PR" : "Open PR"} />}
          {member.status === "asleep" && (
            <Key k="R" label={member.kind === "shell" ? "Restart" : "Resume"} />
          )}
          {member.kind === "agent" && <Key k="K" label="Record" />}
          <Key k="X" label="Send home" />
          <Key k="L" label="Sign" />
        </>
      ) : (
        <>
          <span className="hint__what">{label} · empty</span>
          <Key k="E" label="Hire crew" />
          <Key k="P" label="Hire with a task" />
          <Key k="B" label="Shell" />
          <Key k="L" label="Sign" />
        </>
      )}
    </div>
  );
}

/** Deck name (opens the Flight plan), who's waiting, comms, and a crew-offline warning. */
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
          onClick={() => open({ kind: "flight" })}
          title="Fly to another deck"
        >
          <span className="section-label with-icon">
            <Icon icon={SpaceshipIcon} size={12} /> Deck
          </span>
          <span className="topbar__name">
            <span
              className="dot"
              style={{ "--dot": paintFor(deck.repoPath).trim } as CSSProperties}
            />
            {deck.name}
          </span>
        </button>
        <Surface className="topbar__right">
          {waiting > 0 && (
            <Badge variant="error" icon={<Icon icon={Notification03Icon} size={12} />}>
              {waiting} need{waiting === 1 ? "s" : ""} you
            </Badge>
          )}
          {done > 0 && (
            <Badge variant="success" icon={<Icon icon={CheckmarkCircle02Icon} size={12} />}>
              {done} done
            </Badge>
          )}
          <Badge
            appearance="dot"
            variant={state === "open" ? "success" : state === "connecting" ? "warning" : "error"}
          >
            Comms {state}
          </Badge>
        </Surface>
      </div>
      {blocker && (
        <Banner
          variant="error"
          className="topbar__blocker"
          icon={<Icon icon={Alert02Icon} />}
          description={blocker}
        />
      )}
    </>
  );
}
