import { randomBytes, timingSafeEqual } from "node:crypto";

export interface CrewEntry {
  missionId: string;
  provider: string;
}

interface Registered extends CrewEntry {
  token: string;
}

/** Crew currently on duty and the per-crew secret their hooks must present. */
export class CrewRegistry {
  readonly #crew = new Map<string, Registered>();

  register(crewId: string, entry: CrewEntry): { token: string } {
    const token = randomBytes(32).toString("hex");
    this.#crew.set(crewId, { ...entry, token });
    return { token };
  }

  verify(crewId: string, token: string): CrewEntry | null {
    const crew = this.#crew.get(crewId);
    if (!crew) return null;
    const given = Buffer.from(token);
    const expected = Buffer.from(crew.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return { missionId: crew.missionId, provider: crew.provider };
  }

  unregister(crewId: string): void {
    this.#crew.delete(crewId);
  }
}

const shared = globalThis as typeof globalThis & { __mothershipCrew?: CrewRegistry };

/** The station's crew registry, shared across module reloads in dev. */
export const crewRegistry: CrewRegistry = (shared.__mothershipCrew ??= new CrewRegistry());
