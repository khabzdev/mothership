import { Button } from "@cloudflare/kumo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { notify } from "../../../shared/ui/toasts";
import type { Lesson } from "../debrief.server";
import { MAX_KEPT_LESSONS } from "../model";
import { lessonMutation, lessonsQuery, type LessonAction } from "../queries";

const NO_LESSONS: Lesson[] = [];

/** One-key approvals: Y and N answer a pending lesson, R retires a kept one. */
const KEYS: Record<string, { action: LessonAction; pending: boolean }> = {
  KeyY: { action: "keep", pending: true },
  KeyN: { action: "drop", pending: true },
  KeyR: { action: "retire", pending: false },
};

function LessonItem({
  lesson,
  selected,
  onSelect,
}: {
  lesson: Lesson;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button type="button" className="debrief__lesson" aria-selected={selected} onClick={onSelect}>
        <span className="debrief__text">{lesson.text}</span>
        <span className="debrief__meta">from {lesson.fromName}</span>
        {lesson.state === "pending" && lesson.evidence && (
          <span className="debrief__evidence">{lesson.evidence}</span>
        )}
      </button>
    </li>
  );
}

/**
 * The Debrief window at Flight Control: lessons drafted from missions that hit trouble, waiting for
 * Y (keep) or N (drop), then the kept ones every new crew launch is told, which R retires.
 */
export function DebriefWindow({ deckId }: { deckId: string }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(lessonsQuery(deckId));
  const answer = useMutation(lessonMutation(queryClient, deckId));
  const pending = data?.pending ?? NO_LESSONS;
  const kept = data?.kept ?? NO_LESSONS;
  const rows = [...pending, ...kept];
  const [index, setIndex] = useState(0);
  // A lesson answered drops out of the list: stay on the same place, not past its end.
  const at = Math.min(index, Math.max(rows.length - 1, 0));
  const selected = rows[at];

  const act = (action: LessonAction) => {
    if (!selected || answer.isPending) return;
    answer.mutate(
      { action, lessonId: selected.id },
      {
        onSuccess: (result) => {
          if (!result.ok) notify(result.message, "warning");
        },
        onError: (e: Error) => notify(e.message, "error"),
      },
    );
  };

  // ↑/↓ choose, Y/N/R answer; they never reach game keys or the window behind.
  const keys = useRef({ act, selected, count: rows.length });
  keys.current = { act, selected, count: rows.length };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.code === "ArrowDown" ? 1 : e.code === "ArrowUp" ? -1 : 0;
      const key = KEYS[e.code];
      if (!step && !key) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { act, selected, count } = keys.current;
      if (step) {
        if (count) setIndex((i) => Math.min(Math.max(Math.min(i, count - 1) + step, 0), count - 1));
        return;
      }
      // A held key answers once.
      if (e.repeat || !key || !selected) return;
      if ((selected.state === "pending") === key.pending) act(key.action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="debrief">
      <ErrorNote error={error} />
      {!data && !error && <p className="debrief__note">Loading…</p>}
      {data && rows.length === 0 && (
        <p className="debrief__note">
          No lessons yet. When a mission hits trouble, its debrief drafts some here.
        </p>
      )}
      {pending.length > 0 && (
        <section>
          <h3 className="debrief__heading">To review</h3>
          <ul className="debrief__list">
            {pending.map((lesson, i) => (
              <LessonItem
                key={lesson.id}
                lesson={lesson}
                selected={i === at}
                onSelect={() => setIndex(i)}
              />
            ))}
          </ul>
        </section>
      )}
      {kept.length > 0 && (
        <section>
          <h3 className="debrief__heading">
            Kept · {kept.length} of {MAX_KEPT_LESSONS}
          </h3>
          <ul className="debrief__list">
            {kept.map((lesson, i) => (
              <LessonItem
                key={lesson.id}
                lesson={lesson}
                selected={pending.length + i === at}
                onSelect={() => setIndex(pending.length + i)}
              />
            ))}
          </ul>
        </section>
      )}
      {selected && (
        <footer className="debrief__foot">
          {selected.state === "pending" ? (
            <>
              <Button variant="secondary" disabled={answer.isPending} onClick={() => act("drop")}>
                <kbd>N</kbd> Drop
              </Button>
              <Button variant="primary" loading={answer.isPending} onClick={() => act("keep")}>
                <kbd>Y</kbd> Keep
              </Button>
            </>
          ) : (
            <Button variant="secondary" loading={answer.isPending} onClick={() => act("retire")}>
              <kbd>R</kbd> Retire
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
