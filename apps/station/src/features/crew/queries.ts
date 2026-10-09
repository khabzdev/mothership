import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { crewWorktree, hireCrew, listCrew, promptCrew, sendHomeCrew } from "./crew.functions";
import type { HireInput, SendHomeInput } from "./model";

export const crewKeys = {
  roster: (deckId: string) => ["decks", deckId, "crew"] as const,
  worktree: (crewId: string) => ["crew", crewId, "worktree"] as const,
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

/** What a crew member's own worktree holds, checked fresh each time the dialog opens. */
export const worktreeQuery = (crewId: string) =>
  queryOptions({
    queryKey: crewKeys.worktree(crewId),
    queryFn: () => crewWorktree({ data: { crewId } }),
    staleTime: 0,
  });

export const sendHomeMutation = () =>
  mutationOptions({
    mutationFn: (input: SendHomeInput) => sendHomeCrew({ data: input }),
  });
