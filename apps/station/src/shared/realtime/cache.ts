import type { ServerMsg } from "@mothership/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { setScreen } from "./screens";

export const realtimeKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
  labels: (deckId: string) => ["decks", deckId, "labels"] as const,
};

/** Push realtime state into the Query cache; components only ever read from Query. */
export function applyServerMsg(queryClient: QueryClient, msg: ServerMsg): void {
  if (msg.type === "crew.roster")
    queryClient.setQueryData(realtimeKeys.roster(msg.deckId), msg.crew);
  else if (msg.type === "deck.labels")
    queryClient.setQueryData(realtimeKeys.labels(msg.deckId), msg.labels);
  else if (msg.type === "crew.screen") setScreen(msg.crewId, msg.frame);
  // Terminal traffic is streamed to subscribers, not cached.
}
