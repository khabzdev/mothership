import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { hireCrew, listCrew, promptCrew } from "./crew.functions";
import type { HireInput } from "./model";

export const crewKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
};

export const rosterQuery = (deckId: string) =>
  queryOptions({
    queryKey: crewKeys.roster(deckId),
    queryFn: () => listCrew({ data: { deckId } }),
  });

export const hireMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (input: HireInput) => hireCrew({ data: input }),
    onSuccess: (member) =>
      queryClient.invalidateQueries({ queryKey: crewKeys.roster(member.deckId) }),
  });

export const promptMutation = () =>
  mutationOptions({
    mutationFn: (input: { crewId: string; text: string }) => promptCrew({ data: input }),
  });
