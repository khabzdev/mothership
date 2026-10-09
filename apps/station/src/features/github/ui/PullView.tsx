import { Badge, Button, Loader, Select } from "@cloudflare/kumo";
import { ArrowLeft01Icon, LinkSquare02Icon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { pullColumn, type MergeMethod } from "../model";
import { closePullMutation, mergePullMutation, pullQuery } from "../queries";

const COLUMN = {
  draft: ["Draft", "neutral"],
  review: ["In review", "info"],
  approved: ["Approved", "success"],
  merged: ["Launched", "purple"],
  closed: ["Closed", "neutral"],
} as const;
const CHECK = { pass: "success", fail: "error", pending: "warning", none: "neutral" } as const;
const REVIEW: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "asked for changes",
  COMMENTED: "reviewed",
};

/** One pull request: its checks, reviews and comments, and merging or closing it. */
export function PullView({
  deckId,
  number,
  onBack,
}: {
  deckId: string;
  number: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const pull = useQuery(pullQuery(deckId, number));
  const merge = useMutation(mergePullMutation(queryClient, deckId));
  const closeIt = useMutation(closePullMutation(queryClient, deckId));
  const [method, setMethod] = useState<MergeMethod>("squash");
  const p = pull.data;
  const [column, tone] = p ? COLUMN[pullColumn(p)] : (["", "neutral"] as const);

  return (
    <div className="board-item">
      <div className="board__bar">
        <Button size="sm" variant="ghost" icon={<Icon icon={ArrowLeft01Icon} />} onClick={onBack}>
          Launch board
        </Button>
        {p && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon icon={LinkSquare02Icon} />}
            onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
          >
            On GitHub
          </Button>
        )}
      </div>
      {pull.isPending && (
        <p className="board__empty">
          <Loader size="sm" /> Reading #{number}…
        </p>
      )}
      <ErrorNote error={pull.error} />
      {p && (
        <>
          <header className="board-item__head">
            <h3>
              <span className="board-card__num">#{p.number}</span> {p.title}
            </h3>
            <span className="board-item__meta">
              <Badge variant={tone}>{column}</Badge>
              <span className="muted">
                {p.headRefName} → {p.baseRefName} · <span className="add">+{p.additions}</span>{" "}
                <span className="del">−{p.deletions}</span> · by {p.author}
              </span>
            </span>
          </header>
          {p.checkRuns.length > 0 && (
            <div className="board-item__checks">
              {p.checkRuns.map((c, n) => (
                <Badge key={n} variant={CHECK[c.state]} appearance="dot">
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
          <div className="board-item__body">
            {p.body.trim() ? (
              <p className="board-item__text">{p.body}</p>
            ) : (
              <p className="muted">No description.</p>
            )}
            {p.thread.map((c, n) => (
              <article key={n} className="board-item__comment">
                <strong>
                  {c.author}
                  {c.review && REVIEW[c.review] && (
                    <span className="muted"> {REVIEW[c.review]}</span>
                  )}
                </strong>
                {c.body && <p className="board-item__text">{c.body}</p>}
              </article>
            ))}
          </div>
          {p.state === "OPEN" && (
            <div className="board-item__actions">
              <span className="board-item__close">
                <Select
                  aria-label="How to merge"
                  value={method}
                  onValueChange={(v) => setMethod((v as MergeMethod) ?? "squash")}
                  items={{ squash: "Squash and merge", merge: "Merge commit", rebase: "Rebase" }}
                />
                <Button
                  variant="primary"
                  loading={merge.isPending}
                  disabled={p.isDraft}
                  title={p.isDraft ? "A draft can't be merged" : undefined}
                  icon={<Icon icon={Rocket01Icon} />}
                  onClick={() => merge.mutate({ number, method }, { onSuccess: onBack })}
                >
                  Launch it
                </Button>
              </span>
              <Button
                variant="secondary-destructive"
                loading={closeIt.isPending}
                onClick={() => closeIt.mutate(number, { onSuccess: onBack })}
              >
                Close PR
              </Button>
            </div>
          )}
          <ErrorNote error={merge.error ?? closeIt.error} />
        </>
      )}
    </div>
  );
}
