import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import type { InspectionRecord } from "./inspection.server";
import { parseCrewInspectInput, parseInspectorInput } from "./model";

/** A crew member's inspections this flight, newest first. */
export const getInspections = createServerFn()
  .validator(parseCrewInspectInput)
  .handler(({ data }): InspectionRecord[] => getStation().inspections.history(data.crewId));

/** Starts a manual inspection; `started` is false when one is already going or there is nothing to inspect. */
export const reinspect = createServerFn({ method: "POST" })
  .validator(parseCrewInspectInput)
  .handler(async ({ data }): Promise<{ started: boolean }> => ({
    started: (await getStation().inspections.inspect(data.crewId, "manual")) !== null,
  }));

/** Turns the deck's Inspector on or off. */
export const setInspector = createServerFn({ method: "POST" })
  .validator(parseInspectorInput)
  .handler(({ data }): void => getStation().inspections.setEnabled(data.deckId, data.on));
