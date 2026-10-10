import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { forDeck, pollLine } from "../preflight/poll";
import { rosterQuery } from "../crew/queries";
import { useRealtime } from "../../shared/realtime/RealtimeProvider";
import { playCheck, speak } from "./sound";

const VOICE_KEY = "mothership.poll.voice";

export function voiceOn(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Flight Control's poll: a blip for every check on this deck, and (unless switched off) its callout. */
export function usePreflightPoll(deckId: string, deckName: string): void {
  const { client } = useRealtime();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!client) return;
    const going = new Map<string, boolean>();
    return client.onMessage((raw) => {
      const msg = forDeck(raw, deckId);
      if (!msg) return;
      playCheck(msg.verdict);
      const allGo = (going.get(msg.preflightId) ?? true) && msg.verdict !== "nogo";
      if (msg.done) going.delete(msg.preflightId);
      else going.set(msg.preflightId, allGo);
      if (!voiceOn()) return;
      const crew = queryClient
        .getQueryData(rosterQuery(deckId).queryKey)
        ?.find((c) => c.id === msg.crewId);
      const line = pollLine({
        check: msg.check,
        verdict: msg.verdict,
        done: msg.done,
        allGo,
        deck: deckName,
        crew: crew?.name ?? "crew",
      });
      if (line) speak(line);
    });
  }, [client, deckId, deckName, queryClient]);
}
