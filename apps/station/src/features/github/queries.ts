import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  closeIssue,
  closePull,
  commentIssue,
  getBoard,
  getIssue,
  getPull,
  handIssue,
  mergePull,
} from "./github.functions";
import type { MergeMethod } from "./model";

export const githubKeys = {
  board: (deckId: string) => ["decks", deckId, "github"] as const,
  issue: (deckId: string, n: number) => ["decks", deckId, "github", "issue", n] as const,
  pull: (deckId: string, n: number) => ["decks", deckId, "github", "pull", n] as const,
};

/** The deck's issues and PRs, looked at again every 30 s while you're on the deck. */
export const boardQuery = (deckId: string) =>
  queryOptions({
    queryKey: githubKeys.board(deckId),
    queryFn: () => getBoard({ data: { deckId } }),
    refetchInterval: 30_000,
  });

export const issueQuery = (deckId: string, number: number) =>
  queryOptions({
    queryKey: githubKeys.issue(deckId, number),
    queryFn: () => getIssue({ data: { deckId, number } }),
  });

export const pullQuery = (deckId: string, number: number) =>
  queryOptions({
    queryKey: githubKeys.pull(deckId, number),
    queryFn: () => getPull({ data: { deckId, number } }),
    refetchInterval: 15_000,
  });

const refresh = (queryClient: QueryClient, deckId: string) => () =>
  queryClient.invalidateQueries({ queryKey: githubKeys.board(deckId) });

export const handIssueMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (input: { number: number; consoleId?: number }) =>
      handIssue({ data: { deckId, ...input } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const commentIssueMutation = (queryClient: QueryClient, deckId: string, number: number) =>
  mutationOptions({
    mutationFn: (body: string) => commentIssue({ data: { deckId, number, body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: githubKeys.issue(deckId, number) }),
  });

export const closeIssueMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (input: { number: number; reason: "completed" | "not planned" }) =>
      closeIssue({ data: { deckId, ...input } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const mergePullMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (input: { number: number; method: MergeMethod }) =>
      mergePull({ data: { deckId, ...input } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const closePullMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (number: number) => closePull({ data: { deckId, number } }),
    onSuccess: refresh(queryClient, deckId),
  });
