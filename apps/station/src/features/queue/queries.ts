import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  listQueue,
  queueIssue,
  queueTask,
  removeQueueTask,
  setQueueLimit,
} from "./queue.functions";

export const queueKeys = { deck: (deckId: string) => ["decks", deckId, "queue"] as const };

/** The deck's queue, looked at every few seconds (crew are seated for it on the station). */
export const queueQuery = (deckId: string) =>
  queryOptions({
    queryKey: queueKeys.deck(deckId),
    queryFn: () => listQueue({ data: { deckId } }),
    refetchInterval: 4000,
  });

const refresh = (queryClient: QueryClient, deckId: string) => () =>
  queryClient.invalidateQueries({ queryKey: queueKeys.deck(deckId) });

export const queueTaskMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (text: string) => queueTask({ data: { deckId, text } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const queueIssueMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (number: number) => queueIssue({ data: { deckId, number } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const removeQueueTaskMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (id: string) => removeQueueTask({ data: { id } }),
    onSuccess: refresh(queryClient, deckId),
  });

export const setQueueLimitMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (limit: number) => setQueueLimit({ data: { deckId, limit } }),
    onSuccess: refresh(queryClient, deckId),
  });
