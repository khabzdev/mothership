import { queryOptions } from "@tanstack/react-query";
import { getServiceRecord } from "./ranks.functions";

/** Read fresh each time the window opens: counters change without a message of their own. */
export const serviceRecordQuery = (crewId: string) =>
  queryOptions({
    queryKey: ["ranks", crewId] as const,
    queryFn: () => getServiceRecord({ data: { crewId } }),
    staleTime: 0,
  });
