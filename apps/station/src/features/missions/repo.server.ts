import type { Criterion, CriterionResult, Mission } from "@mothership/mission-engine";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import { criteria, missions, runs } from "../../shared/db/schema";

export type NewCriterion = { kind: "command"; command: string } | { kind: "manual"; label: string };

export interface NewMission {
  deckId: string;
  goal: string;
  criteria: NewCriterion[];
  maxAttempts?: number;
}

export interface MissionRecord {
  id: string;
  deckId: string;
  branch: string | null;
  worktreePath: string | null;
  mission: Mission;
}

/** Insert a mission in briefing with its criteria; returns its id. */
export function createMissionRecord(db: Db, input: NewMission): string {
  const id = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(missions)
      .values({
        id,
        deckId: input.deckId,
        goal: input.goal,
        ...(input.maxAttempts !== undefined && { maxAttempts: input.maxAttempts }),
      })
      .run();
    input.criteria.forEach((c, position) => {
      tx.insert(criteria)
        .values({
          id: crypto.randomUUID(),
          missionId: id,
          position,
          kind: c.kind,
          command: c.kind === "command" ? c.command : null,
          label: c.kind === "manual" ? c.label : null,
        })
        .run();
    });
  });
  return id;
}

/** Rebuild the engine's Mission (plus worktree info) from the database. */
export function loadMission(db: Db, id: string): MissionRecord {
  const row = db.select().from(missions).where(eq(missions.id, id)).get();
  if (!row) throw new Error(`No such mission: ${id}`);

  const brief = {
    goal: row.goal,
    criteria: db
      .select()
      .from(criteria)
      .where(eq(criteria.missionId, id))
      .orderBy(asc(criteria.position))
      .all()
      .map((c): Criterion =>
        c.kind === "command"
          ? { id: c.id, kind: "command", command: c.command ?? "" }
          : { id: c.id, kind: "manual", label: c.label ?? "" },
      ),
  };

  const mission: Mission = {
    state: row.state,
    brief,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    ...(row.alert && { alert: row.alert }),
    ...(row.resumeTo && { resumeTo: row.resumeTo }),
    ...(row.prUrl && { prUrl: row.prUrl }),
  };
  const lastPreflight = latestRuns(db, id);
  if (lastPreflight) mission.lastPreflight = lastPreflight;

  return { id, deckId: row.deckId, branch: row.branch, worktreePath: row.worktreePath, mission };
}

/** Persist the engine's Mission (and optionally worktree info). */
export function saveMission(
  db: Db,
  id: string,
  mission: Mission,
  extras: { branch?: string; worktreePath?: string } = {},
): void {
  db.update(missions)
    .set({
      state: mission.state,
      attempts: mission.attempts,
      maxAttempts: mission.maxAttempts,
      alert: mission.alert ?? null,
      resumeTo: mission.resumeTo ?? null,
      prUrl: mission.prUrl ?? null,
      ...extras,
    })
    .where(eq(missions.id, id))
    .run();
}

export function recordRuns(
  db: Db,
  missionId: string,
  attempt: number,
  results: (CriterionResult & { durationMs?: number })[],
): void {
  db.transaction((tx) => {
    for (const r of results) {
      tx.insert(runs)
        .values({
          id: crypto.randomUUID(),
          missionId,
          criterionId: r.criterionId,
          attempt,
          verdict: r.verdict,
          output: r.output ?? null,
          durationMs: r.durationMs ?? null,
        })
        .run();
    }
  });
}

export function listMissions(db: Db, deckId: string): MissionRecord[] {
  return db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.deckId, deckId))
    .orderBy(desc(missions.createdAt), desc(sql`rowid`))
    .all()
    .map(({ id }) => loadMission(db, id));
}

function latestRuns(db: Db, missionId: string): CriterionResult[] | undefined {
  const latest = db
    .select({ attempt: max(runs.attempt) })
    .from(runs)
    .where(eq(runs.missionId, missionId))
    .get()?.attempt;
  if (latest == null) return undefined;
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.missionId, missionId), eq(runs.attempt, latest)))
    .orderBy(asc(sql`rowid`))
    .all()
    .map((r) => ({
      criterionId: r.criterionId,
      verdict: r.verdict,
      ...(r.output !== null && { output: r.output }),
    }));
}
