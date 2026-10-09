import { createServerFn } from "@tanstack/react-start";
import { crewBlocker } from "../../app/diagnostics";
import { getStation } from "../../app/station.server";
import { getDb } from "../../shared/db/client.server";
import { CONSOLE_COUNT } from "../crew/model";
import { getDeck } from "../decks/decks.server";
import { parseDeckIdInput } from "../decks/model";
import {
  issuePrompt,
  parseCloseIssueInput,
  parseCommentInput,
  parseHandInput,
  parseItemInput,
  parseMergeInput,
} from "./model";

const repo = (deckId: string) => getDeck(getDb(), deckId).repoPath;

/** Whatever gh said, as one line someone can act on. */
async function gh<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const e = error as Error & { stderr?: string };
    throw new Error(e.stderr?.trim().split("\n").at(-1) || e.message);
  }
}

export const getBoard = createServerFn()
  .validator((input: unknown) => ({
    ...parseDeckIdInput(input),
    force: (input as { force?: unknown })?.force === true,
  }))
  .handler(({ data }) => getStation().boards.board(data.deckId, repo(data.deckId), data.force));

export const getIssue = createServerFn()
  .validator(parseItemInput)
  .handler(({ data }) => gh(() => getStation().boards.issue(repo(data.deckId), data.number)));

export const getPull = createServerFn()
  .validator(parseItemInput)
  .handler(({ data }) => gh(() => getStation().boards.pull(repo(data.deckId), data.number)));

/**
 * Hand an issue to crew (agent-office's "Hand to a worker"): a crew member sits down at the given
 * console (or the first free one) in its own worktree with the issue as its task, and the issue is
 * assigned on GitHub so it moves to In progress.
 */
export const handIssue = createServerFn({ method: "POST" })
  .validator(parseHandInput)
  .handler(async ({ data }) => {
    const station = getStation();
    const blocker = crewBlocker(await station.diagnostics());
    if (blocker) throw new Error(blocker);
    const cwd = repo(data.deckId);
    const issue = await gh(() => station.boards.issue(cwd, data.number));
    const taken = new Set(station.crew.roster(data.deckId).map((c) => c.consoleId));
    const consoleId =
      data.consoleId ??
      Array.from({ length: CONSOLE_COUNT }, (_, i) => i).find((i) => !taken.has(i));
    if (consoleId === undefined) throw new Error("Every console is taken: send someone home first");
    const member = await station.crew.hire({
      deckId: data.deckId,
      consoleId,
      task: issuePrompt(issue),
      worktree: true,
    });
    // Assigning can fail (no rights on the repo); the crew member works on it all the same.
    const claimed = await station.boards.claimIssue(cwd, data.number).then(
      () => true,
      () => false,
    );
    station.boards.invalidate(data.deckId);
    return { member, claimed };
  });

export const commentIssue = createServerFn({ method: "POST" })
  .validator(parseCommentInput)
  .handler(({ data }) =>
    gh(() => getStation().boards.commentIssue(repo(data.deckId), data.number, data.body)),
  );

export const closeIssue = createServerFn({ method: "POST" })
  .validator(parseCloseIssueInput)
  .handler(async ({ data }) => {
    const { boards } = getStation();
    await gh(() => boards.closeIssue(repo(data.deckId), data.number, data.reason));
    boards.invalidate(data.deckId);
  });

/** Merge a PR, then look at GitHub again straight away so the launch klaxon sounds. */
export const mergePull = createServerFn({ method: "POST" })
  .validator(parseMergeInput)
  .handler(async ({ data }) => {
    const { boards } = getStation();
    const cwd = repo(data.deckId);
    await gh(() => boards.mergePull(cwd, data.number, data.method));
    await boards.board(data.deckId, cwd, true);
  });

export const closePull = createServerFn({ method: "POST" })
  .validator(parseItemInput)
  .handler(async ({ data }) => {
    const { boards } = getStation();
    await gh(() => boards.closePull(repo(data.deckId), data.number));
    boards.invalidate(data.deckId);
  });
