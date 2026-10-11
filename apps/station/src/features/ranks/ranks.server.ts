import type { RankInfo, ServerMsg } from "@spaceship/protocol";
import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import {
  briefs,
  crew as crewTable,
  inspections,
  missionPrs,
  preflights,
  serviceRecords,
} from "../../shared/db/schema";
import type { CrewService, MissionEnd } from "../crew/service.server";
import { newPatches, pointsOf, rankOf, type PatchId, type ServiceCounters } from "./model";

/** How far back an unmerged pull request is still looked up (days). */
export const RECONCILE_DAYS = 30;

/** A call sign's service record on one deck: its counters and the patches it earned, in order. */
export interface ServiceRecord extends ServiceCounters {
  patches: PatchId[];
}

interface Deps {
  db: Db;
  broadcast: (msg: ServerMsg) => void;
  crew: Pick<CrewService, "refresh">;
}

const ZERO: ServiceCounters = {
  missions: 0,
  merged: 0,
  firstTryGo: 0,
  firstTryClear: 0,
  cleanBriefs: 0,
  lessonsKept: 0,
};

/**
 * Ranks and patches: a service record per call sign per deck, kept after the crew member leaves
 * and inherited by whoever is hired under that name again. Each change that earns a rank or a
 * patch announces it, one message apiece.
 */
export class RankService {
  readonly #db: Db;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #crew: Pick<CrewService, "refresh">;

  constructor(deps: Deps) {
    this.#db = deps.db;
    this.#broadcast = deps.broadcast;
    this.#crew = deps.crew;
  }

  /** The call sign's record on this deck: all zeros before it has one. */
  record(deckId: string, name: string): ServiceRecord {
    const row = this.#db
      .select()
      .from(serviceRecords)
      .where(and(eq(serviceRecords.deckId, deckId), eq(serviceRecords.name, name)))
      .get();
    if (!row) return { ...ZERO, patches: [] };
    return {
      missions: row.missions,
      merged: row.merged,
      firstTryGo: row.firstTryGo,
      firstTryClear: row.firstTryClear,
      cleanBriefs: row.cleanBriefs,
      lessonsKept: row.lessonsKept,
      patches: JSON.parse(row.patches) as PatchId[],
    };
  }

  /** A crew member's rank and patches, for its roster entry. */
  info(crewId: string): { rank: RankInfo; patches?: string[] } | undefined {
    // Read straight from the table: the roster asks while it describes the crew member.
    const member = this.#member(crewId);
    // A shell never earns, and shares its call signs with the agents that do.
    if (!member || member.provider === "shell") return undefined;
    const record = this.record(member.deckId, member.name);
    return {
      rank: rankOf(pointsOf(record)),
      ...(record.patches.length > 0 && { patches: record.patches }),
    };
  }

  /** A brief approved as first written. */
  cleanBrief(crewId: string): void {
    const member = this.#member(crewId);
    if (!member) return;
    this.#change(member.deckId, member.name, { cleanBriefs: 1 }, crewId);
  }

  /** A lesson drafted from this call sign's mission was kept. */
  lessonKept(deckId: string, fromName: string): void {
    this.#change(deckId, fromName, { lessonsKept: 1 });
  }

  /**
   * A mission ended. Its pull request counts the mission and its first tries, read from its own
   * rows; sent home counts nothing (a mission with a PR was counted when it opened).
   */
  onMissionEnd(end: MissionEnd): void {
    if (end.how !== "pr" || !end.prUrl) return;
    // The same pull request again is the same mission: it counts once.
    const { changes } = this.#db
      .insert(missionPrs)
      .values({
        url: end.prUrl,
        deckId: end.deckId,
        name: end.name,
        branch: end.branch ?? null,
        openedAt: end.endedAt,
      })
      .onConflictDoNothing()
      .run();
    if (changes === 0) return;
    const firstGo = this.#first(preflights, end)?.state === "go";
    const firstClear = this.#first(inspections, end)?.state === "cleared";
    const cleanBrief = !!this.#db
      .select({ id: briefs.id })
      .from(briefs)
      .where(
        and(
          eq(briefs.crewId, end.crewId),
          eq(briefs.revision, 1),
          eq(briefs.state, "approved"),
          gte(briefs.createdAt, end.missionSince),
        ),
      )
      .get();
    this.#change(
      end.deckId,
      end.name,
      { missions: 1, firstTryGo: firstGo ? 1 : 0, firstTryClear: firstClear ? 1 : 0 },
      end.crewId,
      { cleanSheet: cleanBrief && firstGo && firstClear },
    );
  }

  /**
   * A pull request merged: credit the call sign that opened it, matched by url, else branch.
   * Each pull request credits once; true only when this call did.
   */
  onMerged(deckId: string, pull: { url: string; branch: string; mergedAt?: number }): boolean {
    const opened =
      this.#db
        .select()
        .from(missionPrs)
        .where(and(eq(missionPrs.deckId, deckId), eq(missionPrs.url, pull.url)))
        .get() ??
      (pull.branch
        ? this.#db
            .select()
            .from(missionPrs)
            .where(and(eq(missionPrs.deckId, deckId), eq(missionPrs.branch, pull.branch)))
            .orderBy(desc(missionPrs.openedAt))
            .get()
        : undefined);
    if (!opened || opened.mergedAt !== null) return false;
    this.#db
      .update(missionPrs)
      .set({ mergedAt: pull.mergedAt ?? Date.now() })
      .where(eq(missionPrs.url, opened.url))
      .run();
    this.#change(deckId, opened.name, { merged: 1 });
    // The mission's verdict is now "Shipped".
    this.#broadcast({ type: "deck.log", deckId });
    return true;
  }

  /**
   * A pull request closed without merging: it leaves the reconcile (merged ones stay as they are).
   * True only when this call marked it.
   */
  onClosed(deckId: string, url: string): boolean {
    const { changes } = this.#db
      .update(missionPrs)
      .set({ closedAt: Date.now() })
      .where(
        and(
          eq(missionPrs.deckId, deckId),
          eq(missionPrs.url, url),
          isNull(missionPrs.mergedAt),
          isNull(missionPrs.closedAt),
        ),
      )
      .run();
    if (changes === 0) return false;
    this.#broadcast({ type: "deck.log", deckId });
    return true;
  }

  /** Pull requests opened in the last 30 days not yet seen merged or closed, oldest first. */
  unmerged(deckId: string, now: number): { url: string; branch: string; openedAt: number }[] {
    return this.#db
      .select({ url: missionPrs.url, branch: missionPrs.branch, openedAt: missionPrs.openedAt })
      .from(missionPrs)
      .where(
        and(
          eq(missionPrs.deckId, deckId),
          isNull(missionPrs.mergedAt),
          isNull(missionPrs.closedAt),
          gte(missionPrs.openedAt, now - RECONCILE_DAYS * 24 * 60 * 60 * 1000),
        ),
      )
      .orderBy(asc(missionPrs.openedAt))
      .all()
      .map((r) => ({ ...r, branch: r.branch ?? "" }));
  }

  /** The mission's first stop run that wasn't cancelled. */
  #first(table: typeof preflights | typeof inspections, end: MissionEnd) {
    return this.#db
      .select({ state: table.state })
      .from(table)
      .where(
        and(
          eq(table.crewId, end.crewId),
          eq(table.trigger, "stop"),
          ne(table.state, "cancelled"),
          gte(table.startedAt, end.missionSince),
        ),
      )
      .orderBy(asc(table.startedAt))
      .get();
  }

  #member(crewId: string) {
    return this.#db
      .select({ deckId: crewTable.deckId, name: crewTable.name, provider: crewTable.provider })
      .from(crewTable)
      .where(eq(crewTable.id, crewId))
      .get();
  }

  /** Add to a record; announce a new rank and each new patch, and refresh the roster. */
  #change(
    deckId: string,
    name: string,
    add: Partial<ServiceCounters>,
    crewId?: string,
    mission?: { cleanSheet: boolean },
  ): void {
    const before = this.record(deckId, name);
    const counters = { ...ZERO };
    for (const key of Object.keys(ZERO) as (keyof ServiceCounters)[]) {
      counters[key] = before[key] + (add[key] ?? 0);
    }
    const earned = newPatches(counters, before.patches, mission);
    const values = {
      ...counters,
      patches: JSON.stringify([...before.patches, ...earned]),
      updatedAt: Date.now(),
    };
    this.#db
      .insert(serviceRecords)
      .values({ deckId, name, ...values })
      .onConflictDoUpdate({ target: [serviceRecords.deckId, serviceRecords.name], set: values })
      .run();

    const was = rankOf(pointsOf(before)).title;
    const now = rankOf(pointsOf(counters)).title;
    if (now !== was || earned.length > 0) {
      // Whoever holds the call sign now is saluted; gone, the toast still names it.
      const id = crewId ?? this.#holder(deckId, name) ?? crypto.randomUUID();
      const base = { type: "crew.promoted", deckId, crewId: id, name } as const;
      if (now !== was) this.#broadcast({ ...base, rank: now });
      for (const patch of earned) this.#broadcast({ ...base, patch });
    }
    this.#crew.refresh(deckId);
  }

  #holder(deckId: string, name: string): string | undefined {
    return this.#db
      .select({ id: crewTable.id })
      .from(crewTable)
      .where(and(eq(crewTable.deckId, deckId), eq(crewTable.name, name)))
      .get()?.id;
  }
}
