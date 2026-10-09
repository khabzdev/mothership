import { CREW_ACTIONS, CREW_STATUSES } from "@mothership/protocol";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

/** A docked repo. Modules are its top-level directories. */
export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull().unique(),
  modules: text("modules", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

/** A crew member at a console on a deck (agent-office's worker). */
export const crew = sqliteTable(
  "crew",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    consoleId: integer("console_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    character: text("character").notNull(),
    provider: text("provider").notNull().default("claude-code"),
    task: text("task").notNull().default(""),
    status: text("status", { enum: CREW_STATUSES }).notNull().default("starting"),
    action: text("action", { enum: CREW_ACTIONS }),
    detail: text("detail"),
    statusSince: integer("status_since").notNull().default(now),
    cwd: text("cwd").notNull(),
    branch: text("branch"),
    prUrl: text("pr_url"),
    /** The agent's own session, for resuming it after it exits (R). */
    sessionId: text("session_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    unique("crew_deck_console_unique").on(t.deckId, t.consoleId),
    check("crew_status_check", oneOf("status", CREW_STATUSES)),
    check("crew_action_check", sql`action is null or ${oneOf("action", CREW_ACTIONS)}`),
  ],
);
