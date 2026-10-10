import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { CheckPatch } from "./model";
import {
  armChecks,
  detectChecks,
  getCheckLog,
  getChecks,
  getDeckPreflights,
  getPreflight,
  runPreflight,
  updateCheck,
} from "./preflight.functions";

/** `["preflight", crewId]` is what the realtime cache invalidates on `crew.preflight`. */
export const preflightQuery = (crewId: string) =>
  queryOptions({
    queryKey: ["preflight", crewId] as const,
    queryFn: () => getPreflight({ data: { crewId } }),
  });

export const checkLogQuery = (preflightId: string, checkId: string) =>
  queryOptions({
    queryKey: ["preflight", "log", preflightId, checkId] as const,
    queryFn: () => getCheckLog({ data: { preflightId, checkId } }),
    staleTime: Infinity,
  });

export const runPreflightMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: () => runPreflight({ data: { crewId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preflight", crewId] }),
  });

/** `["decks", deckId, "checks"]` is what the realtime cache sets on `deck.checks`. */
export const checksQuery = (deckId: string) =>
  queryOptions({
    queryKey: ["decks", deckId, "checks"] as const,
    queryFn: () => getChecks({ data: { deckId } }),
  });

/** The deck's last 10 pre-flights, for Flight Control. */
export const deckPreflightsQuery = (deckId: string) =>
  queryOptions({
    queryKey: ["preflight", "deck", deckId] as const,
    queryFn: () => getDeckPreflights({ data: { deckId } }),
  });

// The server broadcasts `deck.checks` after each of these; refetching too covers a dropped socket.
const refetchChecks = (queryClient: QueryClient, deckId: string) => () =>
  queryClient.invalidateQueries({ queryKey: checksQuery(deckId).queryKey });

export const armChecksMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (armed: boolean) => armChecks({ data: { deckId, armed } }),
    onSettled: refetchChecks(queryClient, deckId),
  });

export const updateCheckMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (patch: Omit<CheckPatch, "deckId">) => updateCheck({ data: { deckId, ...patch } }),
    onSettled: refetchChecks(queryClient, deckId),
  });

export const detectChecksMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: () => detectChecks({ data: { deckId } }),
    onSettled: refetchChecks(queryClient, deckId),
  });
