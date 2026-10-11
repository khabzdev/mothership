import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { realtimeKeys } from "../../shared/realtime/cache";
import { checksQuery } from "../preflight/queries";
import { dropLesson, getLessons, keepLesson, retireLesson } from "./debrief.functions";

/** `realtimeKeys.lessons(deckId)` is what the realtime cache invalidates on `deck.lessons`. */
export const lessonsQuery = (deckId: string) =>
  queryOptions({
    queryKey: realtimeKeys.lessons(deckId),
    queryFn: () => getLessons({ data: { deckId } }),
  });

const ACTIONS = { keep: keepLesson, drop: dropLesson, retire: retireLesson } as const;
export type LessonAction = keyof typeof ACTIONS;

/**
 * Keep, drop or retire a lesson. The server broadcasts `deck.lessons` and `deck.checks` (its
 * pending count); refetching both too covers a dropped socket.
 */
export const lessonMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: ({ action, lessonId }: { action: LessonAction; lessonId: string }) =>
      ACTIONS[action]({ data: { lessonId } }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: lessonsQuery(deckId).queryKey }),
        queryClient.invalidateQueries({ queryKey: checksQuery(deckId).queryKey }),
      ]),
  });
