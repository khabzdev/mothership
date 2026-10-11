import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import type { MissionEntry, MissionSummary } from "./log.server";
import { parseLogInput, parseMissionInput, parseRunInput } from "./model";

/** The deck's missions, newest first: the first page, or the one after `before`. */
export const getLog = createServerFn()
  .validator(parseLogInput)
  .handler(({ data }): MissionSummary[] =>
    getStation().log.list(data.deckId, data.before ? { before: data.before } : {}),
  );

/** One mission with its evidence, or null when there's no such mission. */
export const getMission = createServerFn()
  .validator(parseMissionInput)
  .handler(({ data }): MissionEntry | null => getStation().log.entry(data.missionId));

/** A pre-flight's failing checks with their output, as stored. */
export const getRunOutput = createServerFn()
  .validator(parseRunInput)
  .handler(({ data }): { name: string; tail: string }[] =>
    getStation().log.runOutput(data.preflightId),
  );
