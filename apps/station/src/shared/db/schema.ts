import {
  CHECK_VERDICTS,
  CREW_ACTIONS,
  CREW_STATUSES,
  PREFLIGHT_STATES,
} from "@mothership/protocol";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

/** A docked repo. Modules are its top-level directories. */
export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull().unique(),
  modules: text("modules", { mode: "json" }).$type<string[]>().notNull(),
  /** How many queued tasks may run at once on this deck (0 pauses the queue). */
  queueLimit: integer("queue_limit").notNull().default(3),
  /** Whether pre-flight checks run on this deck: null until the user has been asked. */
  checksArmed: integer("checks_armed", { mode: "boolean" }),
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
    /** Which flight it's on: a new one starts each time you prompt it. */
    flight: integer("flight").notNull().default(1),
    /** Pre-flight hand-backs left this flight. */
    fuel: integer("fuel").notNull().default(3),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    unique("crew_deck_console_unique").on(t.deckId, t.consoleId),
    check("crew_status_check", oneOf("status", CREW_STATUSES)),
    check("crew_action_check", sql`action is null or ${oneOf("action", CREW_ACTIONS)}`),
  ],
);

/** A sign hung over a console, naming what it's for (agent-office's desk labels). */
export const consoleLabels = sqliteTable(
  "console_labels",
  {
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    consoleId: integer("console_id").notNull(),
    text: text("text").notNull(),
    color: text("color").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deckId, t.consoleId] })],
);

/** A check a deck runs before its crew may hand work back (the pre-flight). */
export const deckChecks = sqliteTable("deck_checks", {
  id: text("id").primaryKey(),
  deckId: text("deck_id")
    .notNull()
    .references(() => decks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  command: text("command").notNull(),
  timeoutMs: integer("timeout_ms").notNull().default(300000),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull(),
});

export const QUEUE_STATES = ["queued", "running", "done"] as const;

/** A task waiting for crew (agent-office's task queue): free text, or a GitHub issue. */
export const queueTasks = sqliteTable(
  "queue_tasks",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    issueNumber: integer("issue_number"),
    state: text("state", { enum: QUEUE_STATES }).notNull().default("queued"),
    /** The crew member seated for it, while it runs and after. */
    crewId: text("crew_id"),
    crewName: text("crew_name"),
    createdAt: integer("created_at").notNull().default(now),
  },
  () => [check("queue_tasks_state_check", oneOf("state", QUEUE_STATES))],
);

export const PREFLIGHT_TRIGGERS = ["stop", "manual"] as const;

/**
 * One pre-flight: a deck's checks run in a crew member's worktree. Kept after the crew member
 * leaves, so the deck's history still shows it.
 */
export const preflights = sqliteTable(
  "preflights",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    crewId: text("crew_id").notNull(),
    flight: integer("flight").notNull(),
    attempt: integer("attempt").notNull(),
    state: text("state", { enum: PREFLIGHT_STATES }).notNull().default("running"),
    trigger: text("trigger", { enum: PREFLIGHT_TRIGGERS }).notNull(),
    /** HEAD when it started. */
    commit: text("commit").notNull(),
    /** What the worktree held when it started (see `fingerprint`). */
    fingerprint: text("fingerprint").notNull(),
    startedAt: integer("started_at").notNull().default(now),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("preflights_crew_idx").on(t.crewId, t.startedAt),
    index("preflights_deck_idx").on(t.deckId, t.startedAt),
    check("preflights_state_check", oneOf("state", PREFLIGHT_STATES)),
    check("preflights_trigger_check", oneOf("trigger", PREFLIGHT_TRIGGERS)),
  ],
);

/** How one check came out in a pre-flight; the full output is in its log file. */
export const preflightResults = sqliteTable(
  "preflight_results",
  {
    preflightId: text("preflight_id")
      .notNull()
      .references(() => preflights.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    command: text("command").notNull(),
    verdict: text("verdict", { enum: CHECK_VERDICTS }).notNull(),
    exitCode: integer("exit_code"),
    timedOut: integer("timed_out", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** The end of its output, plain text. */
    tail: text("tail").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.preflightId, t.position] }),
    check("preflight_results_verdict_check", oneOf("verdict", CHECK_VERDICTS)),
  ],
);
