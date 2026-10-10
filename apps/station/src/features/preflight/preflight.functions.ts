import type { DeckCheck } from "@mothership/protocol";
import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseCrewIdInput } from "../crew/model";
import { readCheckLog } from "./log.server";
import { parseArmInput, parseCheckPatch, parseDeckInput, parseLogInput } from "./model";
import type { PreflightRecord } from "./preflight.server";

export interface PreflightView {
  latest: PreflightRecord | null;
  history: PreflightRecord[];
  fuel: number;
  maxFuel: number;
}

export const getPreflight = createServerFn()
  .validator(parseCrewIdInput)
  .handler(({ data }): PreflightView => {
    const { preflight } = getStation();
    const info = preflight.info(data.crewId);
    return {
      latest: preflight.latest(data.crewId),
      history: preflight.history(data.crewId),
      fuel: info?.fuel ?? 0,
      maxFuel: info?.maxFuel ?? 0,
    };
  });

/** A manual run: spends no fuel and never hands anything back. */
export const runPreflight = createServerFn({ method: "POST" })
  .validator(parseCrewIdInput)
  .handler(async ({ data }): Promise<{ id: string | null }> => ({
    id: await getStation().preflight.run(data.crewId, "manual"),
  }));

export const getCheckLog = createServerFn()
  .validator(parseLogInput)
  .handler(({ data }): Promise<string> => readCheckLog(data.preflightId, data.checkId));

/** A deck's checks and whether they're armed (null: you haven't been asked yet). */
export interface DeckChecks {
  armed: boolean | null;
  checks: DeckCheck[];
}

export const getChecks = createServerFn()
  .validator(parseDeckInput)
  .handler(({ data }): DeckChecks => {
    const { checks } = getStation();
    return { armed: checks.armed(data.deckId), checks: checks.list(data.deckId) };
  });

/** Arming runs the checks for the crew that already stopped; disarming just stops them running. */
export const armChecks = createServerFn({ method: "POST" })
  .validator(parseArmInput)
  .handler(async ({ data }): Promise<void> => {
    const { checks, preflight } = getStation();
    if (data.armed) await preflight.arm(data.deckId);
    else checks.arm(data.deckId, false);
  });

export const updateCheck = createServerFn({ method: "POST" })
  .validator(parseCheckPatch)
  .handler(({ data }): DeckCheck => getStation().checks.update(data));

export const detectChecks = createServerFn({ method: "POST" })
  .validator(parseDeckInput)
  .handler(({ data }): Promise<DeckCheck[]> => getStation().checks.detect(data.deckId));

/** The deck's last 10 pre-flights, newest first. */
export const getDeckPreflights = createServerFn()
  .validator(parseDeckInput)
  .handler(({ data }): PreflightRecord[] => getStation().preflight.deckHistory(data.deckId));
