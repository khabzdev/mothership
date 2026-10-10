import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { approveBrief, getBriefs, reviseBrief } from "./briefs.functions";

/** `["brief", crewId]` is what the realtime cache invalidates on `crew.brief`. */
export const briefQuery = (crewId: string) =>
  queryOptions({
    queryKey: ["brief", crewId] as const,
    queryFn: () => getBriefs({ data: { crewId } }),
  });

export const approveBriefMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: () => approveBrief({ data: { crewId } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["brief", crewId] }),
  });

export const reviseBriefMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: (reason: string) => reviseBrief({ data: { crewId, reason } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["brief", crewId] }),
  });
