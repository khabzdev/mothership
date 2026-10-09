import { createServerFn } from "@tanstack/react-start";
import { crewBlocker } from "../../app/diagnostics";
import { getStation } from "../../app/station.server";
import { parseDeckIdInput } from "../decks/model";
import { parseHireInput, parsePromptInput } from "./model";

export const listCrew = createServerFn()
  .validator(parseDeckIdInput)
  .handler(({ data }) => getStation().crew.roster(data.deckId));

export const hireCrew = createServerFn({ method: "POST" })
  .validator(parseHireInput)
  .handler(async ({ data }) => {
    const station = getStation();
    const blocker = crewBlocker(await station.diagnostics());
    if (blocker) throw new Error(blocker);
    return station.crew.hire(data);
  });

export const promptCrew = createServerFn({ method: "POST" })
  .validator(parsePromptInput)
  .handler(({ data }) => getStation().crew.prompt(data.crewId, data.text));
