import { createServerFn } from "@tanstack/react-start";
import { getStation } from "./station.server";

export const getDiagnostics = createServerFn()
  .validator((input: unknown) => ({
    refresh: (input as { refresh?: unknown } | undefined)?.refresh === true,
  }))
  .handler(({ data }) => getStation().diagnostics(data));
