import { Badge, Banner, Surface } from "@cloudflare/kumo";
import {
  Alert02Icon,
  ArrowUpDownIcon,
  CheckmarkCircle02Icon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../../shared/ui/Icon";
import type { ConsoleLabel, CrewInfo } from "@mothership/protocol";
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
export function HintBar({ crew, labels }: { crew: CrewInfo[]; labels: ConsoleLabel[] }) {
  const consoleId = useWorld((s) => s.consoleId);
  const atLift = useWorld((s) => s.atLift);
  if (atLift && consoleId === null) {
    return (
      <div className="hint" data-active>
        <span className="hint__what with-icon">
          <Icon icon={ArrowUpDownIcon} /> Lift
        </span>
        <Key k="E" label="Ride to another deck" />
      </div>
    );
  }
  if (consoleId === null) {
    return (
      <div className="hint">
        <Key k="WASD" label="Walk" />
        <Key k="Shift" label="Run" />
        <Key k="Drag" label="Look" />
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
          {member.branch && <Key k="O" label={member.prUrl ? "See PR" : "Open PR"} />}
          {member.status === "asleep" && (
            <Key k="R" label={member.kind === "shell" ? "Restart" : "Resume"} />
          )}
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

/** Deck name (opens the lift), who's waiting, comms, and a crew-offline warning. */
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
          <span className="eyebrow with-icon">
            <Icon icon={ArrowUpDownIcon} size={12} /> Deck
          </span>
          <span className="topbar__name">{deck.name}</span>
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
