import { Badge, Button } from "@cloudflare/kumo";
import { AirplaneTakeOff01Icon } from "@hugeicons/core-free-icons";
import type { CheckVerdict, CrewInfo } from "@spaceship/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { checkLogQuery, preflightQuery, runPreflightMutation } from "../queries";
import type { PreflightRecord, PreflightResult } from "../preflight.server";

const VERDICT: Record<CheckVerdict, { label: string; tone: "success" | "error" | "neutral" }> = {
  go: { label: "GO", tone: "success" },
  nogo: { label: "NO-GO", tone: "error" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const RUN_TONE = {
  running: { label: "Running", tone: "warning" },
  go: { label: "GO", tone: "success" },
  nogo: { label: "NO-GO", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function CheckLog({ preflightId, checkId }: { preflightId: string; checkId: string }) {
  const log = useQuery(checkLogQuery(preflightId, checkId));
  if (log.isPending) return <p className="preflight__note">Loading the full output…</p>;
  if (log.error) return <ErrorNote error={log.error} />;
  return <pre className="preflight__out">{log.data || "No output."}</pre>;
}

function CheckRow({ preflightId, result }: { preflightId: string; result: PreflightResult }) {
  const [full, setFull] = useState(false);
  const { label, tone } = VERDICT[result.verdict];
  const how = result.timedOut
    ? "timed out"
    : result.exitCode === null
      ? null
      : `exit ${result.exitCode}`;
  return (
    <li className="preflight__check">
      <div className="preflight__row">
        <Badge variant={tone} appearance="dot">
          {label}
        </Badge>
        <span className="preflight__name">{result.name}</span>
        <span className="preflight__meta">
          {[seconds(result.durationMs), how].filter(Boolean).join(" · ")}
        </span>
      </div>
      <code className="preflight__cmd">{result.command}</code>
      {result.verdict !== "skipped" && (
        <>
          {full ? (
            <CheckLog preflightId={preflightId} checkId={result.checkId} />
          ) : (
            result.tail && <pre className="preflight__out">{result.tail}</pre>
          )}
          {!full && (
            <Button size="sm" variant="ghost" onClick={() => setFull(true)}>
              Full output
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function Earlier({ runs }: { runs: PreflightRecord[] }) {
  if (!runs.length) return null;
  return (
    <section className="preflight__earlier">
      <h3 className="preflight__heading">Earlier runs this flight</h3>
      <ul className="preflight__runs">
        {runs.map((run) => {
          const { label, tone } = RUN_TONE[run.state];
          const bad = run.results.filter((r) => r.verdict === "nogo").map((r) => r.name);
          return (
            <li key={run.id} className="preflight__run">
              <Badge variant={tone} appearance="dot">
                {label}
              </Badge>
              <span>
                {run.trigger === "manual" ? "Manual run" : `Attempt ${run.attempt}`} ·{" "}
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

/** The latest pre-flight for a crew member, with the full output on request and a manual re-run. */
export function PreflightWindow({ member }: { member: CrewInfo }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    ...preflightQuery(member.id),
    refetchInterval: (query) => (query.state.data?.latest?.state === "running" ? 2000 : false),
  });
  const run = useMutation(runPreflightMutation(queryClient, member.id));
  const state = member.preflight?.state;

  // A cancelled run doesn't broadcast; the roster's summary changing is how we hear of it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["preflight", member.id] });
  }, [queryClient, member.id, state]);

  const latest = data?.latest ?? null;
  const running = latest?.state === "running";
  const earlier = (data?.history ?? []).filter((r) => r.id !== latest?.id);
  const started = run.data && run.data.id === null;

  return (
    <div className="preflight">
      <div className="preflight__bar">
        <span className="preflight__fuel">
          {latest && (
            <Badge variant={RUN_TONE[latest.state].tone} appearance="dot">
              {RUN_TONE[latest.state].label}
            </Badge>
          )}
          {data && data.maxFuel > 0 && (
            <span>
              Attempt {member.preflight?.attempt ?? latest?.attempt ?? 1} · fuel {data.fuel} of{" "}
              {data.maxFuel}
            </span>
          )}
        </span>
        <Button
          variant="primary"
          icon={<Icon icon={AirplaneTakeOff01Icon} />}
          loading={run.isPending}
          disabled={running}
          onClick={() => run.mutate()}
        >
          Run pre-flight now
        </Button>
      </div>
      <ErrorNote error={error ?? run.error} />
      {started && (
        <p className="preflight__note">
          Nothing to run: pre-flight needs crew in its own worktree and armed checks on this deck.
        </p>
      )}
      {!data && !error && <p className="preflight__note">Loading…</p>}
      {data && !latest && (
        <p className="preflight__note">
          No pre-flight yet. It runs when {member.name} stops, or run it now.
        </p>
      )}
      {latest && (
        <ul className="preflight__checks">
          {latest.results.map((result) => (
            <CheckRow key={result.checkId} preflightId={latest.id} result={result} />
          ))}
          {running && latest.results.length === 0 && (
            <li className="preflight__note">Running the checks…</li>
          )}
        </ul>
      )}
      <Earlier runs={earlier} />
    </div>
  );
}
