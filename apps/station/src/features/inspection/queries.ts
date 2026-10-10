import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { realtimeKeys } from "../../shared/realtime/cache";
import { checksQuery } from "../preflight/queries";
import { getInspections, reinspect, setInspector } from "./inspection.functions";

/** `realtimeKeys.inspection(crewId)` is what the realtime cache invalidates on `crew.inspection`. */
export const inspectionQuery = (crewId: string) =>
  queryOptions({
    queryKey: realtimeKeys.inspection(crewId),
    queryFn: () => getInspections({ data: { crewId } }),
  });

/** Re-inspect a crew member by hand; its inspections refetch once it's accepted or refused. */
export const reinspectMutation = (queryClient: QueryClient, crewId: string) =>
  mutationOptions({
    mutationFn: () => reinspect({ data: { crewId } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: inspectionQuery(crewId).queryKey }),
  });

/**
 * Switch a deck's Inspector on or off. The server broadcasts `deck.checks` after the switch;
 * refetching too covers a dropped socket.
 */
export const setInspectorMutation = (queryClient: QueryClient, deckId: string) =>
  mutationOptions({
    mutationFn: (on: boolean) => setInspector({ data: { deckId, on } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: checksQuery(deckId).queryKey }),
  });
