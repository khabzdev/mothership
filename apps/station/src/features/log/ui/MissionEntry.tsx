import { Badge } from "@cloudflare/kumo";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { BriefText } from "../../briefs/ui/BriefText";
import { FindingList } from "../../inspection/ui/FindingList";
import { RankChevrons } from "../../ranks/ui/RankChevrons";
import type { MissionEntry } from "../log.server";
import type { Outcome, VerdictKind } from "../model";
import { runOutputQuery } from "../queries";

type Tone = "success" | "warning" | "error" | "neutral";

/** A verdict's colour, as the board paints it: clean green, rework amber, open dim, home red. */
export const VERDICT_TONE: Record<VerdictKind, Tone> = {
  clean: "success",
  rework: "warning",
  open: "neutral",
  home: "error",
};

const BRIEF: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  revised: { label: "Revised", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const RUN: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "warning" },
  go: { label: "GO", tone: "success" },
  nogo: { label: "NO-GO", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const REVIEW: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Inspecting", tone: "warning" },
  cleared: { label: "Cleared", tone: "success" },
  flagged: { label: "Flagged", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const LESSON: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "To review", tone: "warning" },
  kept: { label: "Kept", tone: "success" },
  dropped: { label: "Dropped", tone: "neutral" },
  retired: { label: "Retired", tone: "neutral" },
};

const OUTCOME: Record<Outcome, string> = {
  merged: "PR merged",
  open: "PR open",
  closed: "PR closed",
  home: "Sent home",
};

function State({
  of,
  state,
}: {
  of: Record<string, { label: string; tone: Tone }>;
  state: string;
}) {
  const { label, tone } = of[state] ?? { label: state, tone: "neutral" };
  return (
    <Badge variant={tone} appearance="dot">
      {label}
    </Badge>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const when = (at: number) =>
  new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A NO-GO run's failing checks with their output, fetched when shown. */
function RunOutput({ deckId, preflightId }: { deckId: string; preflightId: string }) {
  const { data, error, isPending } = useQuery(runOutputQuery(deckId, preflightId));
  if (error) return <ErrorNote error={error} />;
  if (isPending) return <p className="log-entry__note">Loading the output…</p>;
  if (!data.length) return <p className="log-entry__note">No output kept.</p>;
  return (
    <>
      {data.map((check, i) => (
        <div key={i} className="log-entry__output">
          <span className="log-entry__meta">{check.name}</span>
          <pre className="log-entry__out">{check.tail || "No output."}</pre>
        </div>
      ))}
    </>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="log-entry__section">
      <h3 className="log-entry__heading">{heading}</h3>
      {children}
    </section>
  );
}

/**
 * One mission's log entry, top to bottom: the verdict, its brief, pre-flights, inspections, fuel,
 * outcome and lessons. `showOutput` shows each NO-GO run's failing output, fetched only then.
 * Read-only; the Log window and /lite both use it.
 */
export function MissionEntryView({
  deckId,
  entry,
  showOutput,
}: {
  deckId: string;
  entry: MissionEntry;
  showOutput: boolean;
}) {
  return (
    <article className="log-entry">
      <header className="log-entry__head">
        <p className="log-entry__verdict">
          <Badge variant={VERDICT_TONE[entry.verdict.kind]} appearance="dot">
            {entry.verdict.line}
          </Badge>
        </p>
        <p className="log-entry__who">
          <span className="log-entry__name">{entry.name}</span>
          <RankChevrons title={entry.rank?.title} />
          <span className="log-entry__meta">
            {when(entry.startedAt)} to {when(entry.endedAt)}
          </span>
        </p>
        <p className="log-entry__task">{entry.task}</p>
        {entry.branch && <code className="log-entry__code">{entry.branch}</code>}
      </header>

      <Section heading="Brief">
        {entry.briefs.length === 0 ? (
          <p className="log-entry__note">No brief this mission.</p>
        ) : (
          <ul className="log-entry__list">
            {entry.briefs.map((b) => (
              <li key={b.revision} className="log-entry__item">
                <div className="log-entry__row">
                  <State of={BRIEF} state={b.state} />
                  <span className="log-entry__meta">Rev {b.revision}</span>
                </div>
                {b.reason && <p className="log-entry__note">Your reason: {b.reason}</p>}
                <BriefText text={b.text} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Pre-flight">
        {entry.preflights.length === 0 ? (
          <p className="log-entry__note">No pre-flight ran.</p>
        ) : (
          <ul className="log-entry__list">
            {entry.preflights.map((run) => (
              <li key={run.id} className="log-entry__item">
                <div className="log-entry__row">
                  <State of={RUN} state={run.state} />
                  <span>{run.trigger === "manual" ? "Manual run" : `Attempt ${run.attempt}`}</span>
                  <span className="log-entry__meta">
                    {run.durationMs !== undefined && seconds(run.durationMs)}
                  </span>
                </div>
                {run.commit && <code className="log-entry__code">{run.commit.slice(0, 12)}</code>}
                {run.failed.length > 0 && (
                  <p className="log-entry__note">Failed: {run.failed.join(", ")}</p>
                )}
                {showOutput && run.state === "nogo" && (
                  <RunOutput deckId={deckId} preflightId={run.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Inspections">
        {entry.inspections.length === 0 ? (
          <p className="log-entry__note">No inspection ran.</p>
        ) : (
          <ul className="log-entry__list">
            {entry.inspections.map((review) => (
              <li key={review.id} className="log-entry__item">
                <div className="log-entry__row">
                  <State of={REVIEW} state={review.state} />
                  <span>
                    {review.trigger === "manual" ? "Manual review" : `Attempt ${review.attempt}`}
                  </span>
                </div>
                {review.reason && <p className="log-entry__note">{review.reason}</p>}
                <FindingList
                  heading="Blockers"
                  findings={review.findings.filter((f) => f.severity === "blocker")}
                />
                <FindingList
                  heading="Notes"
                  findings={review.findings.filter((f) => f.severity !== "blocker")}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Fuel spent">
        <p className="log-entry__note">
          {entry.handBacks === 0
            ? "None: nothing was handed back."
            : `${entry.handBacks} ${entry.handBacks === 1 ? "hand-back" : "hand-backs"}`}
        </p>
      </Section>

      <Section heading="Outcome">
        <p className="log-entry__row">
          <span>{OUTCOME[entry.outcome]}</span>
          {entry.prUrl && (
            <a
              className="log-entry__link with-icon"
              href={entry.prUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the PR <Icon icon={LinkSquare02Icon} />
            </a>
          )}
        </p>
      </Section>

      <Section heading="Lessons">
        {entry.lessons.length === 0 ? (
          <p className="log-entry__note">No lessons from this mission.</p>
        ) : (
          <ul className="log-entry__list">
            {entry.lessons.map((lesson) => (
              <li key={lesson.id} className="log-entry__item">
                <div className="log-entry__row">
                  <State of={LESSON} state={lesson.state} />
                </div>
                <p className="log-entry__text">{lesson.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}
