import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spaceshipHome } from "../../shared/home.server.ts";

export interface CrewEntry {
  missionId: string;
  provider: string;
}

interface Registered extends CrewEntry {
  token: string;
}

/**
 * Crew currently on duty and the per-crew secret their hooks must present. With a file, entries
 * survive station restarts, so crew still running in the PTY host keep reporting in.
 */
export class CrewRegistry {
  readonly #crew = new Map<string, Registered>();
  readonly #file: string | undefined;

  constructor(file?: string) {
    this.#file = file;
    if (file) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Registered>;
        for (const [id, entry] of Object.entries(saved)) this.#crew.set(id, entry);
      } catch {
        // Missing or unreadable: start empty.
      }
    }
  }

  register(crewId: string, entry: CrewEntry): { token: string } {
    const token = randomBytes(32).toString("hex");
    this.#crew.set(crewId, { ...entry, token });
    this.#save();
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
    if (this.#crew.delete(crewId)) this.#save();
  }

  #save(): void {
    if (!this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(Object.fromEntries(this.#crew)), { mode: 0o600 });
  }
}

const shared = globalThis as typeof globalThis & { __mothershipCrew?: CrewRegistry };

/** The station's crew registry (persisted in the station home), shared across reloads in dev. */
export const crewRegistry: CrewRegistry = (shared.__mothershipCrew ??= new CrewRegistry(
  join(spaceshipHome(), "crew.json"),
));
