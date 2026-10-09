import { Badge, Button, InputArea, Loader, Select } from "@cloudflare/kumo";
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import {
  queueQuery,
  queueTaskMutation,
  removeQueueTaskMutation,
  setQueueLimitMutation,
} from "../queries";

const LIMITS = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 8].map((n) => [String(n), n === 0 ? "Paused" : `${n} at once`]),
);

/**
 * agent-office's task queue: add tasks and walk away. Whenever a console is free and fewer than the
 * limit are running, the next one gets fresh crew in its own worktree.
 */
export function QueueWindow({ deckId }: { deckId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(queueQuery(deckId));
  const add = useMutation(queueTaskMutation(queryClient, deckId));
  const remove = useMutation(removeQueueTaskMutation(queryClient, deckId));
  const setLimit = useMutation(setQueueLimitMutation(queryClient, deckId));
  const [text, setText] = useState("");
  const tasks = data?.tasks ?? [];
  const groups = [
    ["running", "Running"],
    ["queued", "Up next"],
    ["done", "Done"],
  ] as const;

  return (
    <div className="queue">
      <form
        className="queue__add"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText("") });
        }}
      >
        <InputArea
          aria-label="New task"
          placeholder="A task for the next free crew member"
          autoResize
          minRows={2}
          maxRows={8}
          value={text}
          onValueChange={setText}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText("") });
            }
          }}
        />
        <div className="queue__controls">
          <Select
            aria-label="Crew at once"
            value={String(data?.limit ?? 3)}
            onValueChange={(v) => v && setLimit.mutate(Number(v))}
            items={LIMITS}
          />
          <Button
            type="submit"
            variant="primary"
            loading={add.isPending}
            disabled={!text.trim()}
            icon={<Icon icon={PlusSignIcon} />}
          >
            Add to queue
          </Button>
        </div>
      </form>
      <ErrorNote error={add.error ?? remove.error ?? setLimit.error} />
      {isPending ? (
        <p className="board__empty">
          <Loader size="sm" /> Reading the queue…
        </p>
      ) : (
        <div className="queue__groups">
          {groups.map(([state, title]) => {
            const list = tasks.filter((t) => t.state === state);
            return (
              <section key={state} className="board__column">
                <h4 className="section-label">
                  {title} · {list.length}
                </h4>
                {list.map((t) => (
                  <div key={t.id} className="queue__task">
                    <span className="board-card__title">{t.title}</span>
                    {t.crewName && (
                      <Badge variant={state === "running" ? "warning" : "success"} appearance="dot">
                        {t.crewName}
                      </Badge>
                    )}
                    {state !== "running" && (
                      <Button
                        size="xs"
                        variant="ghost"
                        shape="square"
                        aria-label={state === "queued" ? "Take it off the queue" : "Clear it"}
                        icon={<Icon icon={Cancel01Icon} size={14} />}
                        onClick={() => remove.mutate(t.id)}
                      />
                    )}
                  </div>
                ))}
                {!list.length && <p className="muted queue__none">Nothing here.</p>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
