import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseCrewIdInput } from "../crew/model";
import type { ServiceRecord } from "./ranks.server";

/** K: the service record of the crew member's call sign on its deck. */
export const getServiceRecord = createServerFn()
  .validator(parseCrewIdInput)
  .handler(({ data }): { name: string; record: ServiceRecord } => {
    const station = getStation();
    const member = station.crew.member(data.crewId);
    return { name: member.name, record: station.ranks.record(member.deckId, member.name) };
  });
