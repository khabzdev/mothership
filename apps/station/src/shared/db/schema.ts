import { MISSION_STATES, type Alert } from "@mothership/mission-engine";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

/** A docked repo. Modules are its top-level directories. */
export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull().unique(),
  modules: text("modules", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** One mission on a deck: the engine's Mission, flattened. */
export const missions = sqliteTable(
  "missions",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    state: text("state", { enum: MISSION_STATES }).notNull().default("briefing"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    alert: text("alert", { mode: "json" }).$type<Alert>(),
    resumeTo: text("resume_to", { enum: MISSION_STATES }),
    prUrl: text("pr_url"),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("missions_deck_idx").on(t.deckId),
    check("missions_state_check", oneOf("state", MISSION_STATES)),
    check(
      "missions_resume_to_check",
      sql`resume_to is null or ${oneOf("resume_to", MISSION_STATES)}`,
    ),
  ],
);

export const CRITERION_KINDS = ["command", "manual"] as const;

/** Acceptance criteria of a mission's brief, in order. */
export const criteria = sqliteTable(
  "criteria",
  {
    id: text("id").primaryKey(),
    missionId: text("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: CRITERION_KINDS }).notNull(),
    command: text("command"),
    label: text("label"),
  },
  (t) => [
    unique("criteria_mission_position_unique").on(t.missionId, t.position),
    check("criteria_kind_check", oneOf("kind", CRITERION_KINDS)),
  ],
);

export const VERDICTS = ["go", "nogo"] as const;

/** One pre-flight check result: the evidence shipped with the PR. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    missionId: text("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    criterionId: text("criterion_id")
      .notNull()
      .references(() => criteria.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    verdict: text("verdict", { enum: VERDICTS }).notNull(),
    output: text("output"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_mission_attempt_idx").on(t.missionId, t.attempt),
    check("runs_verdict_check", oneOf("verdict", VERDICTS)),
  ],
);
