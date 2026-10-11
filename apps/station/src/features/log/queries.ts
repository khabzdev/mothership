import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { realtimeKeys } from "../../shared/realtime/cache";
import { getLog, getMission, getRunOutput } from "./log.functions";
import { LOG_PAGE, type LogCursor } from "./model";

/**
 * The deck's log, a page at a time, newest first. `realtimeKeys.log(deckId)` is what the
 * realtime cache invalidates on `deck.log`, and the entries below share its prefix.
 */
export const logQuery = (deckId: string) =>
  infiniteQueryOptions({
    queryKey: [...realtimeKeys.log(deckId), "list"] as const,
    initialPageParam: undefined as LogCursor | undefined,
    queryFn: ({ pageParam }) =>
      getLog({ data: { deckId, ...(pageParam && { before: pageParam }) } }),
    getNextPageParam: (last) => {
      const tail = last[last.length - 1];
      return last.length < LOG_PAGE || !tail ? undefined : { endedAt: tail.endedAt, id: tail.id };
    },
  });

export const missionQuery = (deckId: string, missionId: string) =>
  queryOptions({
    queryKey: [...realtimeKeys.log(deckId), "mission", missionId] as const,
    queryFn: () => getMission({ data: { missionId } }),
  });

/** A pre-flight's failing checks with their output; loaded only when asked for. */
export const runOutputQuery = (deckId: string, preflightId: string) =>
  queryOptions({
    queryKey: [...realtimeKeys.log(deckId), "run", preflightId] as const,
    queryFn: () => getRunOutput({ data: { preflightId } }),
  });
