import { createServerFn } from "@tanstack/react-start";
import { crewBlocker } from "../../app/diagnostics";
import { getStation } from "../../app/station.server";
import { getDb } from "../../shared/db/client.server";
import { getDeck } from "../decks/decks.server";
import { parseDeckIdInput } from "../decks/model";
import { issuePrompt, parseItemInput } from "../github/model";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Crew can't be seated (no claude, no PTY host): queueing would only pile up. */
async function blocked(): Promise<void> {
  const blocker = crewBlocker(await getStation().diagnostics());
  if (blocker) throw new Error(blocker);
}

export const listQueue = createServerFn()
  .validator(parseDeckIdInput)
  .handler(({ data }) => {
    const { queue } = getStation();
    return { tasks: queue.list(data.deckId), limit: queue.limit(data.deckId) };
  });

export const queueTask = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const text = isObject(input) && typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new Error("What's the task?");
    if (text.length > 20_000) throw new Error("Task is too long");
    return { ...parseDeckIdInput(input), text };
  })
  .handler(async ({ data }) => {
    await blocked();
    const title = data.text.split("\n")[0]!.slice(0, 120);
    return getStation().queue.add(data.deckId, { title, prompt: data.text });
  });

/** Put a GitHub issue on the queue (agent-office's Add to queue). */
export const queueIssue = createServerFn({ method: "POST" })
  .validator(parseItemInput)
  .handler(async ({ data }) => {
    await blocked();
    const { boards, queue } = getStation();
    const issue = await boards.issue(getDeck(getDb(), data.deckId).repoPath, data.number);
    return queue.add(data.deckId, {
      title: `#${issue.number} ${issue.title}`,
      prompt: issuePrompt(issue),
      issueNumber: issue.number,
    });
  });

export const removeQueueTask = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = isObject(input) && typeof input.id === "string" ? input.id : "";
    if (!id) throw new Error("id is required");
    return { id };
  })
  .handler(({ data }) => getStation().queue.remove(data.id));

export const setQueueLimit = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const limit = isObject(input) ? input.limit : undefined;
    if (!Number.isInteger(limit) || (limit as number) < 0 || (limit as number) > 16) {
      throw new Error("limit must be 0–16");
    }
    return { ...parseDeckIdInput(input), limit: limit as number };
  })
  .handler(({ data }) => getStation().queue.setLimit(data.deckId, data.limit));
