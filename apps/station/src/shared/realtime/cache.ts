import type { Mission } from "@mothership/mission-engine";
import type { CrewActivity, CrewStatus, DeckId, MissionId, ServerMsg } from "@mothership/protocol";
import type { QueryClient } from "@tanstack/react-query";

export interface CrewStatusData {
  missionId: MissionId | null;
  status: CrewStatus;
  activity?: CrewActivity;
}

export interface MissionData {
  deckId: DeckId;
  mission: Mission;
}

export const realtimeKeys = {
  crewStatus: (crewId: string) => ["crew", crewId, "status"] as const,
  mission: (missionId: string) => ["missions", missionId] as const,
};

/** Push realtime state into the Query cache; components only ever read from Query. */
export function applyServerMsg(queryClient: QueryClient, msg: ServerMsg): void {
  switch (msg.type) {
    case "crew.status":
      queryClient.setQueryData<CrewStatusData>(realtimeKeys.crewStatus(msg.crewId), {
        missionId: msg.missionId,
        status: msg.status,
        ...(msg.activity && { activity: msg.activity }),
      });
      return;
    case "mission.updated":
      queryClient.setQueryData<MissionData>(realtimeKeys.mission(msg.missionId), {
        deckId: msg.deckId,
        mission: msg.mission,
      });
      return;
    default:
      // Terminal traffic is streamed to subscribers, not cached.
      return;
  }
}
