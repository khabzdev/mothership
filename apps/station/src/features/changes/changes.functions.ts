import { createServerFn } from "@tanstack/react-start";
import { parseCrewIdInput } from "../crew/model";
import { commitChanges, changesOf, diffOf, discardChanges } from "./changes.server";
import { parseCommitInput, parseDiscardInput, parseFileInput } from "./model";

export const getChanges = createServerFn()
  .validator(parseCrewIdInput)
  .handler(({ data }) => changesOf(data.crewId));

export const getDiff = createServerFn()
  .validator(parseFileInput)
  .handler(({ data }) => diffOf(data.crewId, data.path));

export const commitCrewChanges = createServerFn({ method: "POST" })
  .validator(parseCommitInput)
  .handler(({ data }) => commitChanges(data.crewId, data.message));

export const discardCrewChanges = createServerFn({ method: "POST" })
  .validator(parseDiscardInput)
  .handler(({ data }) => discardChanges(data.crewId, data.path));
