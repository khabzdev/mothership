import { queryOptions } from "@tanstack/react-query";
import { getHealth } from "./health.functions";

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => getHealth(),
});
