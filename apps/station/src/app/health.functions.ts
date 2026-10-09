import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";
import { getDb } from "../shared/db/client.server";

export const getHealth = createServerFn().handler(async () => {
  const { ok } = getDb().get<{ ok: number }>(sql`select 1 as ok`);
  return { status: "ok" as const, node: process.version, db: ok === 1 ? "ok" : "down" };
});
