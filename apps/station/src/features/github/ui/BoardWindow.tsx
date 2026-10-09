import { Badge, Button, Loader } from "@cloudflare/kumo";
import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import type { BoardId } from "../../world/layout";
import { getBoard } from "../github.functions";
import {
  issueColumn,
  pullColumn,
  type GhIssue,
  type GhPull,
  type IssueColumn,
  type PullColumn,
} from "../model";
import { boardQuery, githubKeys } from "../queries";
import { IssueView } from "./IssueView";
import { PullView } from "./PullView";

const ISSUE_COLUMNS: [IssueColumn, string][] = [
  ["open", "Open"],
  ["progress", "In progress"],
  ["closed", "Closed"],
];
const PULL_COLUMNS: [PullColumn, string][] = [
  ["draft", "Draft"],
  ["review", "In review"],
  ["approved", "Approved"],
  ["merged", "Launched"],
  ["closed", "Closed"],
];
const CHECKS = { pass: "success", fail: "error", pending: "warning", none: "neutral" } as const;

function Labels({ labels }: { labels: string[] }) {
  return labels.length ? (
    <span className="board-card__labels">
      {labels.slice(0, 3).map((l) => (
        <Badge key={l} variant="outline">
          {l}
        </Badge>
      ))}
    </span>
  ) : null;
}

/**
 * agent-office's Issues and PR boards as one window: the cards in their columns, and a card's
 * own view with what you can do about it.
 */
export function BoardWindow({
  deckId,
  board,
  initial,
}: {
  deckId: string;
  board: BoardId;
  initial?: number;
}) {
  const queryClient = useQueryClient();
  const { data, isPending, isFetching } = useQuery(boardQuery(deckId));
  const [selected, setSelected] = useState<number | null>(initial ?? null);
  const refresh = () =>
    void getBoard({ data: { deckId, force: true } }).then((fresh) =>
      queryClient.setQueryData(githubKeys.board(deckId), fresh),
    );

  if (selected !== null) {
    return board === "mission" ? (
      <IssueView deckId={deckId} number={selected} onBack={() => setSelected(null)} />
    ) : (
      <PullView deckId={deckId} number={selected} onBack={() => setSelected(null)} />
    );
  }

  const issues = data?.issues ?? [];
  const pulls = data?.pulls ?? [];
  return (
    <div className="board">
      <div className="board__bar">
        <span className="muted">
          {data?.fetchedAt
            ? `From GitHub ${Math.max(0, Math.round((Date.now() - data.fetchedAt) / 1000))} s ago`
            : "Asking GitHub…"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          loading={isFetching}
          icon={<Icon icon={Refresh01Icon} />}
          onClick={refresh}
        >
          Refresh
        </Button>
      </div>
      {data?.error && <ErrorNote error={{ message: data.error }} />}
      {isPending ? (
        <p className="board__empty">
          <Loader size="sm" /> Asking GitHub…
        </p>
      ) : (
        <div className="board__columns" data-board={board}>
          {board === "mission"
            ? ISSUE_COLUMNS.map(([column, title]) => {
                const cards = issues.filter((i) => issueColumn(i) === column);
                return (
                  <section key={column} className="board__column">
                    <h4 className="section-label">
                      {title} · {cards.length}
                    </h4>
                    {cards.map((i: GhIssue) => (
                      <button
                        key={i.number}
                        type="button"
                        className="board-card"
                        onClick={() => setSelected(i.number)}
                      >
                        <span className="board-card__num">#{i.number}</span>
                        <span className="board-card__title">{i.title}</span>
                        <Labels labels={i.labels} />
                        {i.assignees.length > 0 && (
                          <span className="board-card__meta">→ {i.assignees.join(", ")}</span>
                        )}
                      </button>
                    ))}
                  </section>
                );
              })
            : PULL_COLUMNS.map(([column, title]) => {
                const cards = pulls.filter((p) => pullColumn(p) === column);
                return (
                  <section key={column} className="board__column">
                    <h4 className="section-label">
                      {title} · {cards.length}
                    </h4>
                    {cards.map((p: GhPull) => (
                      <button
                        key={p.number}
                        type="button"
                        className="board-card"
                        onClick={() => setSelected(p.number)}
                      >
                        <span className="board-card__num">
                          #{p.number}
                          {p.checks !== "none" && (
                            <Badge variant={CHECKS[p.checks]} appearance="dot">
                              CI
                            </Badge>
                          )}
                        </span>
                        <span className="board-card__title">{p.title}</span>
                        <span className="board-card__meta">
                          <span className="add">+{p.additions}</span>{" "}
                          <span className="del">−{p.deletions}</span> · {p.headRefName}
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })}
        </div>
      )}
    </div>
  );
}
