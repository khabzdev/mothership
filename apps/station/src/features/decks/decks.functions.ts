import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../../shared/db/client.server";
import { dockRepo as dock, listDecks as list } from "./decks.server";
import { parseDockRepoInput } from "./model";

export const listDecks = createServerFn().handler(() => list(getDb()));

export const dockRepo = createServerFn({ method: "POST" })
  .validator(parseDockRepoInput)
  .handler(({ data }) => dock(getDb(), data.repoPath));
