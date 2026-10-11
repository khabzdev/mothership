import { Badge, Button } from "@cloudflare/kumo";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { RankChevrons } from "../../ranks/ui/RankChevrons";
import type { MissionSummary } from "../log.server";
import { endedAgo, selectionIndex, stepSelection } from "../model";
import { logQuery, missionQuery } from "../queries";
import { MissionEntryView, VERDICT_TONE } from "./MissionEntry";

const NO_MISSIONS: MissionSummary[] = [];

/** The selected mission's entry, or what's keeping it. */
function Entry({
  deckId,
  missionId,
  showOutput,
}: {
  deckId: string;
  missionId: string;
  showOutput: boolean;
}) {
  const { data, error } = useQuery(missionQuery(deckId, missionId));
  if (error) return <ErrorNote error={error} />;
  if (data === undefined) return <p className="log__note">Loading…</p>;
  if (data === null) return <p className="log__note">This mission isn't in the log.</p>;
  return <MissionEntryView deckId={deckId} entry={data} showOutput={showOutput} />;
}

/**
 * The Captain's log at its board: every mission that ended, newest first, and the selected one's
 * evidence. ↑/↓ choose, Enter shows the NO-GO runs' output, O opens the PR. Nothing here edits.
 */
export function LogWindow({ deckId }: { deckId: string }) {
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery(
    logQuery(deckId),
  );
  const missions = data?.pages.flat() ?? NO_MISSIONS;
  // By id: a mission logged while the window is open lands above, not in place of, this one.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ids = missions.map((m) => m.id);
  const at = selectionIndex(ids, selectedId);
  const selected = missions[at];
  /** The mission whose NO-GO output is showing, if any: Enter toggles it, moving on hides it. */
  const [shownFor, setShownFor] = useState<string | null>(null);
  const showOutput = !!selected && shownFor === selected.id;
  // Shares the entry's cache: whether Enter has any output to show.
  const entry = useQuery({ ...missionQuery(deckId, selected?.id ?? ""), enabled: !!selected });
  const hasNogo = !!entry.data?.preflights.some((r) => r.state === "nogo");

  const rows = useRef<HTMLUListElement>(null);
  useEffect(() => {
    rows.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  // ↑/↓, Enter and O never reach game keys or the window behind.
  const keys = useRef({ selected, ids, hasNogo });
  keys.current = { selected, ids, hasNogo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.code === "ArrowDown" ? 1 : e.code === "ArrowUp" ? -1 : 0;
      const enter = e.code === "Enter" || e.code === "NumpadEnter";
      if (!step && !enter && e.code !== "KeyO") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      // Enter on a link or the Older button does what it says.
      if (enter && target?.closest("a, [data-native-enter]")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { selected, ids, hasNogo } = keys.current;
      if (step) {
        const next = stepSelection(ids, selected?.id ?? null, step);
        if (next) setSelectedId(next);
        return;
      }
      // A held key acts once.
      if (e.repeat || !selected) return;
      if (enter) {
        // Enter on a mission row reached with Tab chooses that one.
        const row = target?.closest<HTMLElement>("[data-mission]")?.dataset.mission;
        if (row && row !== selected.id) setSelectedId(row);
        else if (hasNogo) setShownFor((id) => (id === selected.id ? null : selected.id));
      } else if (selected.prUrl) window.open(selected.prUrl, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="log__note">Loading…</p>;
  if (missions.length === 0)
    return (
      <p className="log__note">
        No missions logged yet. Missions appear here when crew open a PR or go home.
      </p>
    );

  return (
    <div className="log">
      <div className="log__missions">
        <ul className="log__list" ref={rows}>
          {missions.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className="log__mission"
                data-mission={m.id}
                aria-selected={i === at}
                onClick={() => setSelectedId(m.id)}
              >
                <span className="log__who">
                  <span className="log__name">{m.name}</span>
                  <RankChevrons title={m.rank?.title} />
                  <span className="log__meta">{endedAgo(Date.now() - m.endedAt)}</span>
                </span>
                <span className="log__task">{m.task}</span>
                <Badge variant={VERDICT_TONE[m.verdict.kind]} appearance="dot">
                  {m.verdict.line}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        {hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            data-native-enter
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            Older
          </Button>
        )}
      </div>
      <div className="log__entry">
        {selected && <Entry deckId={deckId} missionId={selected.id} showOutput={showOutput} />}
      </div>
      <footer className="log__foot">
        <span className="log__meta">
          <kbd>↑</kbd> <kbd>↓</kbd> choose
          {hasNogo && (
            <>
              {" "}
              · <kbd>Enter</kbd> {showOutput ? "hide the output" : "show the NO-GO output"}
            </>
          )}
          {selected?.prUrl && (
            <>
              {" "}
              · <kbd>O</kbd> open the PR
            </>
          )}
        </span>
      </footer>
    </div>
  );
}
