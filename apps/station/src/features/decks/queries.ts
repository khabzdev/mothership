import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  cancelClone,
  dockRepo,
  ghRepos,
  listClones,
  listDecks,
  startClone,
} from "./decks.functions";

export const deckKeys = {
  all: ["decks"] as const,
  clones: ["clones"] as const,
  ghRepos: ["gh", "repos"] as const,
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

/** Clones in progress; kept fresh by deck.clones over the station socket. */
export const clonesQuery = queryOptions({
  queryKey: deckKeys.clones,
  queryFn: () => listClones(),
});

export const ghReposQuery = queryOptions({
  queryKey: deckKeys.ghRepos,
  queryFn: () => ghRepos(),
  staleTime: 60_000,
});

export const startCloneMutation = () =>
  mutationOptions({ mutationFn: (spec: string) => startClone({ data: { spec } }) });

export const cancelCloneMutation = () =>
  mutationOptions({ mutationFn: (id: string) => cancelClone({ data: { id } }) });
