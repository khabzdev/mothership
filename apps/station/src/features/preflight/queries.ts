import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { getCheckLog, getPreflight, runPreflight } from "./preflight.functions";

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
