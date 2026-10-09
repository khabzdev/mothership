import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { findLines, parseSearchInput, plainLines, type SearchHit } from "./model";

/** Every crew terminal on the deck, scrollback and all, for lines with every word of the query. */
export const searchTerminals = createServerFn()
  .validator(parseSearchInput)
  .handler(async ({ data }): Promise<SearchHit[]> => {
    if (!data.query) return [];
    const { crew, launcher } = getStation();
    const results = await Promise.all(
      crew.roster(data.deckId).map(async (member) => {
        const snapshot = await launcher.snapshot(member.id).catch(() => null);
        if (!snapshot) return [];
        return findLines(plainLines(snapshot.snapshot), data.query).map((hit) => ({
          crewId: member.id,
          name: member.name,
          ...hit,
        }));
      }),
    );
    return results.flat().slice(0, 200);
  });
