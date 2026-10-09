import { queryOptions } from "@tanstack/react-query";
import { getDiagnostics } from "./diagnostics.functions";

export const diagnosticsQuery = queryOptions({
  queryKey: ["station", "diagnostics"],
  queryFn: () => getDiagnostics({ data: {} }),
  staleTime: 30_000,
});
