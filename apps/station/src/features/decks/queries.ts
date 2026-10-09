import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { dockRepo, listDecks } from "./decks.functions";

export const deckKeys = {
  all: ["decks"] as const,
};

export const decksQuery = queryOptions({
  queryKey: deckKeys.all,
  queryFn: () => listDecks(),
});

export const dockRepoMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (repoPath: string) => dockRepo({ data: { repoPath } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deckKeys.all }),
  });
