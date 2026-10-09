import { createServerFn } from "@tanstack/react-start";

export const getHealth = createServerFn().handler(async () => ({
  status: "ok" as const,
  node: process.version,
}));
