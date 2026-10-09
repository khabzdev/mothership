import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { commitCrewChanges, discardCrewChanges, getChanges, getDiff } from "./changes.functions";

export const changesKeys = {
  all: (crewId: string) => ["crew", crewId, "changes"] as const,
  diff: (crewId: string, path: string) => ["crew", crewId, "changes", "diff", path] as const,
};

/** Refreshed every couple of seconds while the window is open, as agent-office does. */
export const changesQuery = (crewId: string) =>
  queryOptions({
    queryKey: changesKeys.all(crewId),
    queryFn: () => getChanges({ data: { crewId } }),
    refetchInterval: 2000,
  });

export const diffQuery = (crewId: string, path: string) =>
  queryOptions({
    queryKey: changesKeys.diff(crewId, path),
    queryFn: () => getDiff({ data: { crewId, path } }),
    refetchInterval: 2000,
  });

const refresh = (queryClient: QueryClient, crewId: string) => () =>
  queryClient.invalidateQueries({ queryKey: changesKeys.all(crewId) });

export const commitMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: (message: string) => commitCrewChanges({ data: { crewId, message } }),
    onSuccess: refresh(queryClient, crewId),
  });

export const discardMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: (path?: string) => discardCrewChanges({ data: { crewId, ...(path && { path }) } }),
    onSuccess: refresh(queryClient, crewId),
  });
