import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MissionRecord } from "../model";
import { launchMissionMutation } from "../queries";
import { fuelGauge, missionLamp } from "./status";

/** One mission as a flight-plan card. */
export function MissionCard({ record }: { record: MissionRecord }) {
  const queryClient = useQueryClient();
  const launch = useMutation(launchMissionMutation(queryClient));
  const { mission } = record;
  const lamp = missionLamp(mission);

  return (
    <article
      className="flight-plan"
      data-tone={lamp.tone}
      aria-label={`Mission: ${mission.brief.goal}`}
    >
      <header className="flight-plan__head">
        <span className="status">
          <span className="lamp" data-tone={lamp.tone} />
          {lamp.label}
        </span>
        <span
          className="fuel"
          title={`${mission.attempts} of ${mission.maxAttempts} attempts used`}
        >
          <span className="fuel__label">Fuel</span>
          {fuelGauge(mission).map((segment, i) => (
            <span key={i} className="fuel__cell" data-state={segment} />
          ))}
        </span>
      </header>

      <h3 className="flight-plan__goal">{mission.brief.goal}</h3>

      {mission.alert && (
        <p role="alert" className="flight-plan__alert">
          {mission.alert.detail}
        </p>
      )}

      <ol className="criteria">
        {mission.brief.criteria.map((c) => {
          const result = mission.lastPreflight?.find((r) => r.criterionId === c.id);
          return (
            <li key={c.id} data-verdict={result?.verdict ?? "pending"}>
              {c.kind === "command" ? <code>{c.command}</code> : <span>{c.label}</span>}
              {c.kind === "manual" && <span className="tag">manual</span>}
            </li>
          );
        })}
      </ol>

      <footer className="flight-plan__foot">
        <span className="readout">{record.branch ?? "no branch yet"}</span>
        {mission.prUrl && (
          <a className="readout" href={mission.prUrl} target="_blank" rel="noreferrer">
            Pull request ↗
          </a>
        )}
        {mission.state === "briefing" && (
          <button
            type="button"
            className="button"
            onClick={() => launch.mutate(record.id)}
            disabled={launch.isPending}
          >
            {launch.isPending ? "Launching…" : "Launch"}
          </button>
        )}
      </footer>
      {launch.error && (
        <p role="alert" className="error">
          {launch.error.message}
        </p>
      )}
    </article>
  );
}
