import type { ServerMsg } from "@mothership/protocol";
import type { QueryClient } from "@tanstack/react-query";

export const realtimeKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
};

/** Push realtime state into the Query cache; components only ever read from Query. */
export function applyServerMsg(queryClient: QueryClient, msg: ServerMsg): void {
  if (msg.type === "crew.roster")
    queryClient.setQueryData(realtimeKeys.roster(msg.deckId), msg.crew);
  // Terminal traffic is streamed to subscribers, not cached.
}
