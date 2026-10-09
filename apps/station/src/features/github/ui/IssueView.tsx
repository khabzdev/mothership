import { Badge, Button, InputArea, Loader, Select } from "@cloudflare/kumo";
import {
  ArrowLeft01Icon,
  Comment01Icon,
  LinkSquare02Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { useWorld } from "../../world/store";
import { issueColumn } from "../model";
import {
  closeIssueMutation,
  commentIssueMutation,
  handIssueMutation,
  issueQuery,
} from "../queries";

/** One issue: what it says, its comments, and agent-office's actions on it. */
export function IssueView({
  deckId,
  number,
  onBack,
}: {
  deckId: string;
  number: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { close, say } = useWorld.getState();
  const issue = useQuery(issueQuery(deckId, number));
  const hand = useMutation(handIssueMutation(queryClient, deckId));
  const comment = useMutation(commentIssueMutation(queryClient, deckId, number));
  const closeIt = useMutation(closeIssueMutation(queryClient, deckId));
  const [text, setText] = useState("");
  const [reason, setReason] = useState<"completed" | "not planned">("completed");
  const i = issue.data;

  return (
    <div className="board-item">
      <div className="board__bar">
        <Button size="sm" variant="ghost" icon={<Icon icon={ArrowLeft01Icon} />} onClick={onBack}>
          Mission board
        </Button>
        {i && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon icon={LinkSquare02Icon} />}
            onClick={() => window.open(i.url, "_blank", "noopener,noreferrer")}
          >
            On GitHub
          </Button>
        )}
      </div>
      {issue.isPending && (
        <p className="board__empty">
          <Loader size="sm" /> Reading #{number}…
        </p>
      )}
      <ErrorNote error={issue.error} />
      {i && (
        <>
          <header className="board-item__head">
            <h3>
              <span className="board-card__num">#{i.number}</span> {i.title}
            </h3>
            <span className="board-item__meta">
              <Badge
                variant={
                  issueColumn(i) === "closed"
                    ? "neutral"
                    : issueColumn(i) === "progress"
                      ? "warning"
                      : "success"
                }
              >
                {issueColumn(i) === "closed"
                  ? "Closed"
                  : issueColumn(i) === "progress"
                    ? "In progress"
                    : "Open"}
              </Badge>
              {i.labels.map((l) => (
                <Badge key={l} variant="outline">
                  {l}
                </Badge>
              ))}
              <span className="muted">
                by {i.author}
                {i.assignees.length > 0 && ` · assigned to ${i.assignees.join(", ")}`}
              </span>
            </span>
          </header>
          <div className="board-item__body">
            {i.body.trim() ? (
              <p className="board-item__text">{i.body}</p>
            ) : (
              <p className="muted">No description.</p>
            )}
            {i.thread.map((c, n) => (
              <article key={n} className="board-item__comment">
                <strong>{c.author}</strong>
                <p className="board-item__text">{c.body}</p>
              </article>
            ))}
          </div>
          {i.state === "OPEN" && (
            <div className="board-item__actions">
              <Button
                variant="primary"
                loading={hand.isPending}
                icon={<Icon icon={UserAdd01Icon} />}
                onClick={() =>
                  hand.mutate(
                    { number },
                    {
                      onSuccess: ({ member, claimed }) => {
                        close();
                        say(
                          `🚀 ${member.name} took #${number} at Console ${member.consoleId + 1}${claimed ? "" : " (couldn't assign it on GitHub)"}`,
                        );
                      },
                    },
                  )
                }
              >
                Hand to crew
              </Button>
              <span className="board-item__close">
                <Select
                  aria-label="Why it's closed"
                  value={reason}
                  onValueChange={(v) => setReason((v as typeof reason) ?? "completed")}
                  items={{ completed: "Completed", "not planned": "Not planned" }}
                />
                <Button
                  variant="secondary-destructive"
                  loading={closeIt.isPending}
                  onClick={() => closeIt.mutate({ number, reason }, { onSuccess: onBack })}
                >
                  Close issue
                </Button>
              </span>
            </div>
          )}
          <form
            className="board-item__reply"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) comment.mutate(text, { onSuccess: () => setText("") });
            }}
          >
            <InputArea
              aria-label="Comment"
              placeholder="Add a comment"
              autoResize
              minRows={2}
              maxRows={8}
              value={text}
              onValueChange={setText}
            />
            <Button
              type="submit"
              variant="outline"
              loading={comment.isPending}
              disabled={!text.trim()}
              icon={<Icon icon={Comment01Icon} />}
            >
              Comment
            </Button>
          </form>
          <ErrorNote error={hand.error ?? comment.error ?? closeIt.error} />
        </>
      )}
    </div>
  );
}
