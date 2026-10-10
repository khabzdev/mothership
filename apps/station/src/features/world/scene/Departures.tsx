import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useRef, useState } from "react";
import { CONSOLES, departurePath } from "../layout";
import { Departing } from "./Departing";

interface Leaving {
  crew: CrewInfo;
  path: { x: number; z: number }[];
}

/**
 * Whoever leaves the roster (sent home here or by anyone else) walks out through the garage. A
 * new deck's roster is a fresh start: nobody on it is leaving.
 */
export function Departures({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const last = useRef<{ deckId: string; crew: CrewInfo[] }>({ deckId, crew });
  const [leaving, setLeaving] = useState<Leaving[]>([]);

  useEffect(() => {
    const before = last.current;
    last.current = { deckId, crew };
    if (before.deckId !== deckId) return setLeaving([]);
    const gone = before.crew.filter((c) => !crew.some((n) => n.id === c.id));
    if (!gone.length) return;
    setLeaving((list) => [
      ...list,
      ...gone.flatMap((c) => {
        const def = CONSOLES[c.consoleId];
        return def ? [{ crew: c, path: departurePath(def) }] : [];
      }),
    ]);
  }, [deckId, crew]);

  return leaving.map(({ crew: c, path }) => (
    <Departing
      key={c.id}
      crew={c}
      path={path}
      onGone={() => setLeaving((list) => list.filter((l) => l.crew.id !== c.id))}
    />
  ));
}
