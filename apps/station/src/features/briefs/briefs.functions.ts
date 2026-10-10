import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseCrewIdInput } from "../crew/model";
import type { BriefAnswer, BriefRecord } from "./briefs.server";
import { parseReviseInput } from "./model";

/** A crew member's briefs, newest first. */
export const getBriefs = createServerFn()
  .validator(parseCrewIdInput)
  .handler(({ data }): BriefRecord[] => getStation().briefs.history(data.crewId));

export const approveBrief = createServerFn({ method: "POST" })
  .validator(parseCrewIdInput)
  .handler(({ data }): Promise<BriefAnswer> => getStation().briefs.approve(data.crewId));

export const reviseBrief = createServerFn({ method: "POST" })
  .validator(parseReviseInput)
  .handler(({ data }): Promise<BriefAnswer> =>
    getStation().briefs.revise(data.crewId, data.reason),
  );
