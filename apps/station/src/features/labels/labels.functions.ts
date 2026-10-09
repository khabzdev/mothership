import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseDeckIdInput } from "../decks/model";
import { parseLabelInput } from "./model";

export const listLabels = createServerFn()
  .validator(parseDeckIdInput)
  .handler(({ data }) => getStation().labels.list(data.deckId));

export const setLabel = createServerFn({ method: "POST" })
  .validator(parseLabelInput)
  .handler(({ data }) => getStation().labels.set(data));
