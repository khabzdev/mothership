import { createServerFn } from "@tanstack/react-start";
import { crewBlocker } from "../../app/diagnostics";
import { getStation } from "../../app/station.server";
import { parseDeckIdInput } from "../decks/model";
import { parseCrewIdInput, parseHireInput, parsePromptInput, parseSendHomeInput } from "./model";

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

export const crewWorktree = createServerFn()
  .validator(parseCrewIdInput)
  .handler(({ data }) => getStation().crew.worktree(data.crewId));

export const sendHomeCrew = createServerFn({ method: "POST" })
  .validator(parseSendHomeInput)
  .handler(({ data }) => getStation().crew.sendHome(data.crewId, data.worktree));

export const openShell = createServerFn({ method: "POST" })
  .validator(parseHireInput)
  .handler(({ data }) => getStation().crew.openShell(data));

export const resumeCrew = createServerFn({ method: "POST" })
  .validator(parseCrewIdInput)
  .handler(async ({ data }) => {
    const station = getStation();
    const member = station.crew.member(data.crewId);
    if (member.kind === "agent") {
      const blocker = crewBlocker(await station.diagnostics());
      if (blocker) throw new Error(blocker);
    }
    return station.crew.resume(data.crewId);
  });
