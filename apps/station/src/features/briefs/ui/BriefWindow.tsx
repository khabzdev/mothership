import { Badge, Button, Input } from "@cloudflare/kumo";
import type { BriefState, CrewInfo } from "@spaceship/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { playCheck, speak } from "../../world/sound";
import { useWorld } from "../../world/store";
import { voiceOn } from "../../world/usePreflightPoll";
import type { BriefRecord } from "../briefs.server";
import { REASON_MAX } from "../model";
import { approveBriefMutation, briefQuery, reviseBriefMutation } from "../queries";
import { BriefText } from "./BriefText";

const STATE: Record<BriefState, { label: string; tone: "warning" | "success" | "neutral" }> = {
  waiting: { label: "Waiting for you", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  revised: { label: "Revised", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function approvedLine(brief: BriefRecord): string {
  if (brief.approvedBy === "terminal") return "Approved in terminal";
  return `Approved rev ${brief.revision} · ${time(brief.settledAt ?? brief.createdAt)}`;
}

function Earlier({ briefs }: { briefs: BriefRecord[] }) {
  if (!briefs.length) return null;
  return (
    <details className="brief__earlier">
      <summary>Earlier revisions ({briefs.length})</summary>
      <ul className="brief__revs">
        {briefs.map((b) => (
          <li key={b.id} className="brief__rev">
            <div className="brief__row">
              <Badge variant={STATE[b.state].tone} appearance="dot">
                {b.state === "approved" ? approvedLine(b) : STATE[b.state].label}
              </Badge>
              <span className="brief__meta">
                Rev {b.revision} · {time(b.createdAt)}
              </span>
            </div>
            {b.reason && <p className="brief__reason">{b.reason}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A crew member's brief: read it, then Y to approve or N and a line to send it back. */
export function BriefWindow({ member }: { member: CrewInfo }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(briefQuery(member.id));
  const approve = useMutation(approveBriefMutation(queryClient, member.id));
  const revise = useMutation(reviseBriefMutation(queryClient, member.id));
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState("");

  const latest = data?.[0] ?? null;
  const waiting = latest?.state === "waiting";
  const busy = approve.isPending || revise.isPending;

  const settle = (
    result: { ok: true } | { ok: false; message: string; openTerminal: boolean },
    onOk?: () => void,
  ) => {
    const { say, open } = useWorld.getState();
    if (result.ok) return onOk?.();
    if (result.openTerminal) {
      say(result.message, "error");
      open({ kind: "terminal", crewId: member.id });
    } else say(result.message, "info");
  };

  const doApprove = () => {
    if (!waiting || busy) return;
    approve.mutate(undefined, {
      onSuccess: (result) =>
        settle(result, () => {
          playCheck("go");
          if (voiceOn()) speak(`${member.name}, brief approved`);
        }),
    });
  };

  const doRevise = () => {
    const text = reason.trim();
    if (!waiting || busy || !text) return;
    revise.mutate(text, {
      onSuccess: (result) =>
        settle(result, () => {
          setRevising(false);
          setReason("");
        }),
    });
  };

  // Y and N work while the window is open, except when typing the reason; they never reach game keys.
  const act = useRef({ waiting, busy, doApprove, ask: () => setRevising(true) });
  act.current = { waiting, busy, doApprove, ask: () => setRevising(true) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyY" && e.code !== "KeyN") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { waiting, busy, doApprove, ask } = act.current;
      if (!waiting || busy) return;
      if (e.code === "KeyY") doApprove();
      else ask();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="brief">
      {latest && (
        <div className="brief__bar">
          <Badge variant={STATE[latest.state].tone} appearance="dot">
            {latest.state === "approved" ? approvedLine(latest) : STATE[latest.state].label}
          </Badge>
          <span className="brief__meta">
            Rev {latest.revision} · {time(latest.createdAt)}
          </span>
        </div>
      )}
      <ErrorNote error={error ?? approve.error ?? revise.error} />
      {!data && !error && <p className="brief__note">Loading…</p>}
      {data && !latest && <p className="brief__note">No brief yet.</p>}
      {latest && <BriefText text={latest.text} />}
      {waiting && (
        <footer className="brief__foot">
          {revising ? (
            <form
              className="brief__revise"
              onSubmit={(e) => {
                e.preventDefault();
                doRevise();
              }}
            >
              <Input
                autoFocus
                aria-label="What to change"
                placeholder="What should change?"
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  setRevising(false);
                }}
              />
              <Button
                type="submit"
                variant="primary"
                loading={revise.isPending}
                disabled={!reason.trim()}
              >
                Send back
              </Button>
            </form>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setRevising(true)}>
                <kbd>N</kbd> Revise
              </Button>
              <Button variant="primary" loading={approve.isPending} onClick={doApprove}>
                <kbd>Y</kbd> Approve
              </Button>
            </>
          )}
        </footer>
      )}
      <Earlier briefs={(data ?? []).slice(1)} />
    </div>
  );
}
