import type { ServerMsg } from "@mothership/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { setScreen } from "./screens";

export const realtimeKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
  labels: (deckId: string) => ["decks", deckId, "labels"] as const,
  checks: (deckId: string) => ["decks", deckId, "checks"] as const,
  preflight: (crewId: string) => ["preflight", crewId] as const,
  decks: ["decks"] as const,
  clones: ["clones"] as const,
};

/** Push realtime state into the Query cache; components only ever read from Query. */
export function applyServerMsg(queryClient: QueryClient, msg: ServerMsg): void {
  if (msg.type === "crew.roster")
    queryClient.setQueryData(realtimeKeys.roster(msg.deckId), msg.crew);
  else if (msg.type === "deck.labels")
    queryClient.setQueryData(realtimeKeys.labels(msg.deckId), msg.labels);
  else if (msg.type === "deck.checks")
    queryClient.setQueryData(realtimeKeys.checks(msg.deckId), {
      armed: msg.armed,
      checks: msg.checks,
    });
  else if (msg.type === "crew.preflight")
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.preflight(msg.crewId) });
  else if (msg.type === "deck.clones") {
    const known = queryClient.getQueryData<{ id: string }[]>(realtimeKeys.decks) ?? [];
    queryClient.setQueryData(realtimeKeys.clones, msg.clones);
    // A clone that's done is a new deck: fetch the deck list again.
    if (msg.clones.some((c) => c.deckId && !known.some((d) => d.id === c.deckId)))
      void queryClient.invalidateQueries({ queryKey: realtimeKeys.decks, exact: true });
  } else if (msg.type === "crew.screen") setScreen(msg.crewId, msg.frame);
  // Terminal traffic is streamed to subscribers, not cached.
}
