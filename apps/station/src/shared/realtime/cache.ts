import type { ServerMsg } from "@mothership/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { setScreen } from "./screens";

export const realtimeKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
  labels: (deckId: string) => ["decks", deckId, "labels"] as const,
  checks: (deckId: string) => ["decks", deckId, "checks"] as const,
  ranks: (crewId: string) => ["ranks", crewId] as const,
  lessons: (deckId: string) => ["decks", deckId, "lessons"] as const,
  /** The Captain's log: the list and each entry share this prefix. */
  log: (deckId: string) => ["decks", deckId, "log"] as const,
  preflight: (crewId: string) => ["preflight", crewId] as const,
  brief: (crewId: string) => ["brief", crewId] as const,
  inspection: (crewId: string) => ["inspection", crewId] as const,
  decks: ["decks"] as const,
  clones: ["clones"] as const,
};

const ranksFamily = ["ranks"] as const;

/** Push realtime state into the Query cache; components only ever read from Query. */
export function applyServerMsg(queryClient: QueryClient, msg: ServerMsg): void {
  if (msg.type === "crew.roster") {
    queryClient.setQueryData(realtimeKeys.roster(msg.deckId), msg.crew);
    // Counter changes always refresh the roster: an open service record is stale too.
    void queryClient.invalidateQueries({ queryKey: ranksFamily });
  } else if (msg.type === "crew.promoted")
    void queryClient.invalidateQueries({ queryKey: ranksFamily });
  else if (msg.type === "deck.labels")
    queryClient.setQueryData(realtimeKeys.labels(msg.deckId), msg.labels);
  else if (msg.type === "deck.checks")
    queryClient.setQueryData(realtimeKeys.checks(msg.deckId), {
      armed: msg.armed,
      checks: msg.checks,
      inspector: msg.inspector,
      lessonsPending: msg.lessonsPending,
    });
  else if (msg.type === "deck.lessons") {
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.lessons(msg.deckId) });
    // The debrief drafts a mission's lessons after the mission is logged.
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.log(msg.deckId) });
  } else if (msg.type === "deck.log")
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.log(msg.deckId) });
  else if (msg.type === "crew.preflight")
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.preflight(msg.crewId) });
  else if (msg.type === "crew.brief")
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.brief(msg.crewId) });
  else if (msg.type === "crew.inspection")
    void queryClient.invalidateQueries({ queryKey: realtimeKeys.inspection(msg.crewId) });
  else if (msg.type === "deck.clones") {
    const known = queryClient.getQueryData<{ id: string }[]>(realtimeKeys.decks) ?? [];
    queryClient.setQueryData(realtimeKeys.clones, msg.clones);
    // A clone that's done is a new deck: fetch the deck list again.
    if (msg.clones.some((c) => c.deckId && !known.some((d) => d.id === c.deckId)))
      void queryClient.invalidateQueries({ queryKey: realtimeKeys.decks, exact: true });
  } else if (msg.type === "crew.screen") setScreen(msg.crewId, msg.frame);
  // Terminal traffic is streamed to subscribers, not cached.
}
