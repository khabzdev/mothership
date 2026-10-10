import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseCrewIdInput } from "../crew/model";
import { readCheckLog } from "./log.server";
import { parseLogInput } from "./model";
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
