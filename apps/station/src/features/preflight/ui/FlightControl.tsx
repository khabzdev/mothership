import { Badge, Button, Input, Select, Switch } from "@cloudflare/kumo";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { CrewInfo, DeckCheck } from "@mothership/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { diagnosticsQuery } from "../../../app/queries";
import { NO_SMOKE } from "../../../app/smoke";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { InspectorSwitch } from "../../inspection/ui/InspectorSwitch";
import { TIMEOUTS_MS } from "../model";
import {
  armChecksMutation,
  checksQuery,
  deckPreflightsQuery,
  detectChecksMutation,
  updateCheckMutation,
} from "../queries";
import { RUN_TONE } from "./PreflightWindow";

/** Whether the station reads the go/no-go poll aloud (chimes play either way). */
export const POLL_VOICE_KEY = "mothership.poll.voice";

export function pollVoiceOn(): boolean {
  try {
    return localStorage.getItem(POLL_VOICE_KEY) !== "0";
  } catch {
    return true;
  }
}

const TIMEOUTS = Object.fromEntries(TIMEOUTS_MS.map((ms) => [String(ms), `${ms / 60_000} min`]));

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function CheckRow({ deckId, check }: { deckId: string; check: DeckCheck }) {
  const queryClient = useQueryClient();
  const update = useMutation(updateCheckMutation(queryClient, deckId));
  const [command, setCommand] = useState(check.command);
  useEffect(() => setCommand(check.command), [check.command]);

  const save = () => {
    const next = command.trim();
    if (!next) return setCommand(check.command);
    if (next !== check.command) update.mutate({ checkId: check.id, command: next });
  };

  return (
    <li className="flight-control__check">
      <Switch
        label={check.name}
        checked={check.enabled}
        onCheckedChange={(enabled) => update.mutate({ checkId: check.id, enabled })}
      />
      <Input
        aria-label={`${check.name} command`}
        className="flight-control__command"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <Select
        aria-label={`${check.name} timeout`}
        value={String(check.timeoutMs)}
        onValueChange={(v) => v && update.mutate({ checkId: check.id, timeoutMs: Number(v) })}
        items={TIMEOUTS}
      />
      <ErrorNote error={update.error} />
    </li>
  );
}

function DeckHistory({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const queryClient = useQueryClient();
  const { data: runs, error } = useQuery(deckPreflightsQuery(deckId));
  // Runs finishing show up in the roster's summaries; that's when to look again.
  const states = crew.map((c) => `${c.id}:${c.preflight?.state}:${c.preflight?.attempt}`).join();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: deckPreflightsQuery(deckId).queryKey });
  }, [queryClient, deckId, states]);

  return (
    <section>
      <h3 className="preflight__heading">Last pre-flights on this deck</h3>
      <ErrorNote error={error} />
      {runs && !runs.length && <p className="preflight__note">No pre-flights yet.</p>}
      <ul className="preflight__runs">
        {runs?.map((run) => {
          const { label, tone } = RUN_TONE[run.state];
          const who = crew.find((c) => c.id === run.crewId)?.name ?? "Crew that went home";
          const bad = run.results.filter((r) => r.verdict === "nogo").map((r) => r.name);
          return (
            <li key={run.id} className="preflight__run">
              <Badge variant={tone} appearance="dot">
                {label}
              </Badge>
              <span>
                {who} · {run.trigger === "manual" ? "manual run" : `attempt ${run.attempt}`} ·{" "}
                {time(run.startedAt)}
              </span>
              {bad.length > 0 && <span className="preflight__meta">{bad.join(", ")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The last real-claude smoke: each check, and how to refresh it. */
function Tooling() {
  const { data } = useQuery(diagnosticsQuery);
  const smoke = data?.smoke ?? NO_SMOKE;
  return (
    <section>
      <h3 className="preflight__heading">Tooling</h3>
      <p className="preflight__note" data-smoke={smoke.state}>
        {smoke.line}
      </p>
      {smoke.checks.length > 0 && (
        <ul className="flight-control__smoke">
          {smoke.checks.map((check) => (
            <li key={check.id} data-state={check.state}>
              <code>{check.id}</code>
              <span>{check.state}</span>
              <span className="preflight__meta">{check.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="preflight__note">
        Run <code>vp run smoke:real</code> in apps/station to refresh
      </p>
    </section>
  );
}

/** Flight Control: the deck's pre-flight checks, armed or not, each one editable. */
export function FlightControlWindow({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(checksQuery(deckId));
  const arm = useMutation(armChecksMutation(queryClient, deckId));
  const detect = useMutation(detectChecksMutation(queryClient, deckId));
  const [voice, setVoice] = useState(pollVoiceOn);

  return (
    <div className="preflight">
      <div className="flight-control__deck">
        <Switch
          label="Armed"
          checked={data?.armed === true}
          disabled={!data || arm.isPending}
          onCheckedChange={(armed) => arm.mutate(armed)}
        />
        <Switch
          label="Spoken poll"
          checked={voice}
          onCheckedChange={(on) => {
            setVoice(on);
            try {
              localStorage.setItem(POLL_VOICE_KEY, on ? "1" : "0");
            } catch {
              // preference only
            }
          }}
        />
        <InspectorSwitch deckId={deckId} />
        <Button
          variant="secondary"
          icon={<Icon icon={RefreshIcon} />}
          loading={detect.isPending}
          onClick={() => detect.mutate()}
        >
          Detect again
        </Button>
      </div>
      <ErrorNote error={error ?? arm.error ?? detect.error} />
      {!data && !error && <p className="preflight__note">Loading…</p>}
      {data && !data.checks.length && (
        <p className="preflight__note">
          No checks found in this repo, so pre-flight won&apos;t run. Detect again after adding a
          check, lint or test script.
        </p>
      )}
      {data && data.checks.length > 0 && (
        <ul className="flight-control__checks">
          {data.checks.map((check) => (
            <CheckRow key={check.id} deckId={deckId} check={check} />
          ))}
        </ul>
      )}
      <DeckHistory deckId={deckId} crew={crew} />
      <Tooling />
    </div>
  );
}
