import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { getDb } from "../../shared/db/client.server";
import { dockRepo as dock, listDecks as list, listGhRepos } from "./decks.server";
import { parseDockRepoInput } from "./model";

export const listDecks = createServerFn().handler(() => list(getDb()));

export const dockRepo = createServerFn({ method: "POST" })
  .validator(parseDockRepoInput)
  .handler(({ data }) => dock(getDb(), data.repoPath));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const listClones = createServerFn().handler(() => getStation().clones.list());

export const startClone = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const spec = isObject(input) && typeof input.spec === "string" ? input.spec.trim() : "";
    if (!spec) throw new Error("Which repo? Give owner/name or a git URL");
    return { spec };
  })
  .handler(({ data }) => getStation().clones.start(data.spec));

export const cancelClone = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = isObject(input) && typeof input.id === "string" ? input.id : "";
    if (!id) throw new Error("id is required");
    return { id };
  })
  .handler(({ data }) => getStation().clones.cancel(data.id));

/** The repos your gh login can see, to pick from. */
export const ghRepos = createServerFn().handler(() => listGhRepos());
