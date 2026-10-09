import { createServerFn } from "@tanstack/react-start";
import { crewBlocker } from "../../app/diagnostics";
import { getDb } from "../../shared/db/client.server";
import { parseCreateMissionInput, parseDeckIdInput, parseMissionIdInput } from "./model";
import { createMissionRecord, listMissions as list, loadMission } from "./repo.server";
import { getStation } from "./station.server";

export const listMissions = createServerFn()
  .validator(parseDeckIdInput)
  .handler(({ data }) => list(getDb(), data.deckId));

export const createMission = createServerFn({ method: "POST" })
  .validator(parseCreateMissionInput)
  .handler(({ data }) => loadMission(getDb(), createMissionRecord(getDb(), data)));

export const launchMission = createServerFn({ method: "POST" })
  .validator(parseMissionIdInput)
  .handler(async ({ data }) => {
    const station = getStation();
    const blocker = crewBlocker(await station.diagnostics());
    if (blocker) throw new Error(blocker);
    await station.ready;
    const result = await station.runtime.dispatch(data.missionId, { type: "launchCrew" });
    if (!result.ok) throw new Error(result.error);
    return loadMission(getDb(), data.missionId);
  });
