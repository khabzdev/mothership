import { Badge, Button } from "@cloudflare/kumo";
import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { notify } from "../../../shared/ui/toasts";
import type { InspectionRecord } from "../inspection.server";
import { windowSections } from "../model";
import { inspectionQuery, reinspectMutation } from "../queries";
import { FindingList } from "./FindingList";

const STATE: Record<
  InspectionRecord["state"],
  { label: string; tone: "warning" | "success" | "error" | "neutral" }
> = {
  running: { label: "Inspecting…", tone: "warning" },
  cleared: { label: "Cleared", tone: "success" },
  flagged: { label: "Flagged", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function stateLine(member: CrewInfo, record: InspectionRecord): string {
  const { preflight } = member;
  const parts = [STATE[record.state].label];
  parts.push(
    preflight
      ? `attempt ${record.attempt} of ${preflight.maxFuel + 1}`
      : `attempt ${record.attempt}`,
  );
  if (preflight) parts.push(`fuel ${preflight.fuel}`);
  return parts.join(" · ");
}

function scopeLine(outside: number, lines: number): string {
  const files = outside
    ? `${outside} ${outside === 1 ? "file" : "files"} outside the brief`
    : "No files outside the brief";
  return lines ? `${files} · ${lines} lines changed` : files;
}

/** A crew member's inspection: the verdict, what was found, and I to look again once it's done. */
export function InspectionWindow({ member }: { member: CrewInfo }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(inspectionQuery(member.id));
  const again = useMutation(reinspectMutation(queryClient, member.id));
  const { current, blockers, notes, earlier, outside, lines } = windowSections(data ?? []);
  const running = current?.state === "running";

  const reinspect = () => {
    if (running || again.isPending) return;
    again.mutate(undefined, {
      onSuccess: ({ started }) => notify(started ? "Re-inspecting…" : "Already inspecting"),
    });
  };

  // I re-inspects while the window is open and the run is finished; it never reaches game keys.
  const act = useRef({ ready: false, reinspect });
  act.current = { ready: current !== null && !running, reinspect };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyI") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (act.current.ready) act.current.reinspect();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="inspection">
      <ErrorNote error={error ?? again.error} />
      {!data && !error && <p className="inspection__note">Loading…</p>}
      {data && !current && <p className="inspection__note">Not inspected yet.</p>}
      {current && (
        <>
          <div className="inspection__bar">
            <Badge variant={STATE[current.state].tone} appearance="dot">
              {stateLine(member, current)}
            </Badge>
            <span className="inspection__meta">{time(current.startedAt)}</span>
          </div>
          {running && <p className="inspection__note">Scanning…</p>}
          {current.reason && <p className="inspection__note">{current.reason}</p>}
          <FindingList heading="Blockers" findings={blockers} />
          <FindingList heading="Notes" findings={notes} />
          {!running && <p className="inspection__note">{scopeLine(outside, lines)}</p>}
          {!running && (
            <footer className="inspection__foot">
              <Button variant="secondary" loading={again.isPending} onClick={reinspect}>
                <kbd>I</kbd> Re-inspect
              </Button>
            </footer>
          )}
        </>
      )}
      {earlier.length > 0 && (
        <details className="inspection__earlier">
          <summary>Earlier runs ({earlier.length})</summary>
          <ul className="inspection__runs">
            {earlier.map((r) => (
              <li key={r.id} className="inspection__run">
                <Badge variant={STATE[r.state].tone} appearance="dot">
                  {STATE[r.state].label}
                </Badge>
                <span className="inspection__meta">
                  Attempt {r.attempt} · {time(r.startedAt)} · {r.findings.length}{" "}
                  {r.findings.length === 1 ? "finding" : "findings"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
