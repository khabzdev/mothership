import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { NewMission } from "./repo.server";
import { createMission, launchMission, listMissions } from "./missions.functions";

export const missionKeys = {
  byDeck: (deckId: string) => ["decks", deckId, "missions"] as const,
};

export const missionsQuery = (deckId: string) =>
  queryOptions({
    queryKey: missionKeys.byDeck(deckId),
    queryFn: () => listMissions({ data: { deckId } }),
  });

export const createMissionMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (brief: NewMission) => createMission({ data: brief }),
    onSuccess: (record) =>
      queryClient.invalidateQueries({ queryKey: missionKeys.byDeck(record.deckId) }),
  });

export const launchMissionMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (missionId: string) => launchMission({ data: { missionId } }),
    onSuccess: (record) =>
      queryClient.invalidateQueries({ queryKey: missionKeys.byDeck(record.deckId) }),
  });
