import {
  transition,
  type Mission,
  type MissionEffect,
  type MissionEvent,
  type TransitionResult,
} from "@mothership/mission-engine";
import type { ServerMsg } from "@mothership/protocol";
import type { CrewSignal } from "@mothership/providers";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { decks, missions } from "../../shared/db/schema";
import type { CrewLauncher } from "../crew/launcher.server";
import type { CrewSignalEvent } from "../crew/hooks.server";
import { briefPrompt } from "./prompt";
import { loadMission, saveMission, type MissionRecord } from "./repo.server";
import { branchName, createWorktree } from "./worktree.server";

export const crewIdFor = (missionId: string) => `crew-${missionId}`;
const missionIdFor = (crewId: string) => crewId.replace(/^crew-/, "");

export interface EffectContext<T extends MissionEffect["type"] = MissionEffect["type"]> {
  missionId: string;
  record: MissionRecord;
  effect: Extract<MissionEffect, { type: T }>;
}

type EffectHandler<T extends MissionEffect["type"]> = (ctx: EffectContext<T>) => Promise<void>;

export interface MissionRuntimeDeps {
  db: Db;
  launcher: CrewLauncher;
  broadcast: (msg: ServerMsg) => void;
  /** Mothership home; worktrees live under `<home>/worktrees`. */
  home: string;
}

/** Which mission events a crew signal implies, given where the mission is. */
export function eventsForSignal(signal: CrewSignal, mission: Mission): MissionEvent[] {
  const awaitingInput = mission.state === "redAlert" && mission.alert?.reason === "needsInput";
  switch (signal.type) {
    case "needsInput":
      return mission.state === "building"
        ? [{ type: "crewNeedsInput", detail: signal.detail }]
        : [];
    case "working":
      return awaitingInput ? [{ type: "resume" }] : [];
    case "stopped":
      if (mission.state === "building") return [{ type: "crewStopped" }];
      return awaitingInput ? [{ type: "resume" }, { type: "crewStopped" }] : [];
    case "ended":
      return mission.state === "building"
        ? [{ type: "crewCrashed", detail: `Crew session ended (${signal.reason})` }]
        : [];
    case "idle":
      return [];
  }
}

/**
 * Drives missions: applies engine transitions, persists and broadcasts them, and performs the
 * resulting effects. Work for one mission is queued so hooks arriving together can't race.
 */
export class MissionRuntime {
  readonly #deps: MissionRuntimeDeps;
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #effects: { [T in MissionEffect["type"]]?: EffectHandler<T> } = {};

  constructor(deps: MissionRuntimeDeps) {
    this.#deps = deps;
    this.setEffect("startCrew", (ctx) => this.#startCrew(ctx));
  }

  setEffect<T extends MissionEffect["type"]>(type: T, handler: EffectHandler<T>): void {
    (this.#effects as Record<T, EffectHandler<T>>)[type] = handler;
  }

  dispatch(missionId: string, event: MissionEvent): Promise<TransitionResult> {
    return this.#enqueue(missionId, () => this.#apply(missionId, event));
  }

  handleSignal({ missionId, signal }: CrewSignalEvent): Promise<void> {
    return this.#enqueue(missionId, async () => {
      const { mission } = loadMission(this.#deps.db, missionId);
      for (const event of eventsForSignal(signal, mission)) await this.#apply(missionId, event);
    });
  }

  handleCrewExit(crewId: string, exitCode: number): Promise<void> {
    const missionId = missionIdFor(crewId);
    return this.#enqueue(missionId, async () => {
      if (loadMission(this.#deps.db, missionId).mission.state !== "building") return;
      await this.#apply(missionId, {
        type: "crewCrashed",
        detail: `Crew process exited with code ${exitCode}`,
      });
    });
  }

  /** On startup: missions still building whose crew session is gone or exited become crashes. */
  async reconcile(sessions: { id: string; exited: boolean; exitCode?: number }[]): Promise<void> {
    const building = this.#deps.db
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.state, "building"))
      .all();
    for (const { id } of building) {
      const session = sessions.find((s) => s.id === crewIdFor(id));
      if (session && !session.exited) continue;
      await this.dispatch(id, {
        type: "crewCrashed",
        detail: session
          ? `Crew process exited with code ${session.exitCode ?? "unknown"}`
          : "Crew session was lost while the station was down",
      });
    }
  }

  #enqueue<T>(missionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(missionId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.#queues.set(
      missionId,
      next.catch(() => {}),
    );
    return next;
  }

  async #apply(missionId: string, event: MissionEvent): Promise<TransitionResult> {
    const { db, broadcast } = this.#deps;
    const record = loadMission(db, missionId);
    const result = transition(record.mission, event);
    if (!result.ok) return result;

    saveMission(db, missionId, result.mission);
    broadcast({
      type: "mission.updated",
      missionId,
      deckId: record.deckId,
      mission: result.mission,
    });

    for (const effect of result.effects) {
      const handler = this.#effects[effect.type] as EffectHandler<typeof effect.type> | undefined;
      try {
        await handler?.({
          missionId,
          record: loadMission(db, missionId),
          effect,
        } as never);
      } catch (error) {
        if (loadMission(db, missionId).mission.state === "building") {
          await this.#apply(missionId, { type: "crewCrashed", detail: (error as Error).message });
        } else {
          console.error(`Mission ${missionId}: ${effect.type} failed`, error);
        }
      }
    }
    return result;
  }

  async #startCrew({ missionId, record, effect }: EffectContext<"startCrew">): Promise<void> {
    const { db, home, launcher } = this.#deps;
    const deck = db.select().from(decks).where(eq(decks.id, record.deckId)).get();
    if (!deck) throw new Error(`No such deck: ${record.deckId}`);

    const worktree = await createWorktree({
      repoPath: deck.repoPath,
      path: join(home, "worktrees", `${deck.name}-${deck.id.slice(0, 8)}`, missionId.slice(0, 8)),
      branch: record.branch ?? branchName(effect.brief.goal, missionId),
    });
    saveMission(db, missionId, record.mission, {
      branch: worktree.branch,
      worktreePath: worktree.path,
    });
    await launcher.launch({
      crewId: crewIdFor(missionId),
      missionId,
      provider: "claude-code",
      prompt: briefPrompt(effect.brief),
      cwd: worktree.path,
    });
  }
}
