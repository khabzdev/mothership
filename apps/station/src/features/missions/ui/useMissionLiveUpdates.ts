import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import type { MissionRecord } from "../model";
import { missionKeys } from "../queries";

/** Keep a deck's mission board in step with mission.updated broadcasts. */
export function useMissionLiveUpdates(deckId: string): void {
  const queryClient = useQueryClient();
  const { client } = useRealtime();

  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type !== "mission.updated" || msg.deckId !== deckId) return;
      const key = missionKeys.byDeck(deckId);
      const list = queryClient.getQueryData<MissionRecord[]>(key);
      if (!list?.some((r) => r.id === msg.missionId)) {
        void queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      queryClient.setQueryData<MissionRecord[]>(key, (records) =>
        records?.map((r) => (r.id === msg.missionId ? { ...r, mission: msg.mission } : r)),
      );
    });
  }, [client, deckId, queryClient]);
}
