import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { rosterQuery } from "../../crew/queries";
import { clonesQuery, decksQuery } from "../../decks/queries";
import { playDone, playHeadsUp, playNeedsYou } from "../sound";
import { useWorld } from "../store";
import { Fresh, bannerText, needingYou } from "../waiting";

/**
 * agent-office's needs-you banner under the top bar: who, what it's asking and for how long, a click
 * (or N) away. The screen's edge flashes red and the alarm rings when one starts asking.
 */
export function NeedsYouBanner({ crew, go }: { crew: CrewInfo[]; go: (id: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState(0);
  /** The waits the banner was put away on: it comes back for anyone else, or a new wait. */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const fresh = useRef(new Fresh());
  const asking = needingYou(crew);

  useEffect(() => {
    const changed = fresh.current.take(crew);
    if (changed.some((c) => c.status === "needs_input")) {
      setFlash((n) => n + 1);
      playNeedsYou();
    } else if (changed.some((c) => c.status === "done")) {
      playDone();
    }
  }, [crew]);

  useEffect(() => {
    if (!asking.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [asking.length]);

  const waitKey = (c: CrewInfo) => `${c.id}@${c.statusSince}`;
  const text = bannerText(
    asking.filter((c) => !hidden.has(waitKey(c))),
    now,
  );

  return (
    <>
      {text && (
        <div className="needs-you" role="status" aria-live="polite" key={text.id}>
          <button
            type="button"
            className="needs-you__go"
            title={`Go to ${text.title.replace(/ needs you$/, "")}'s console (N)`}
            onClick={() => go(text.id)}
          >
            <span className="needs-you__icon" aria-hidden>
              🙋
            </span>
            <span className="needs-you__text">
              <strong>{text.title}</strong>
              {text.detail && <span>{text.detail}</span>}
            </span>
            {text.more && <span className="needs-you__more">{text.more}</span>}
            <kbd>N</kbd>
          </button>
          <button
            type="button"
            className="needs-you__x"
            aria-label="Hide"
            title="Hide until another crew member needs you"
            onClick={() => setHidden(new Set(asking.map(waitKey)))}
          >
            ✕
          </button>
        </div>
      )}
      {flash > 0 && <div key={flash} className="needs-you-flash" aria-hidden />}
    </>
  );
}

/**
 * A heads-up when a crew member on another deck starts waiting on you (agent-office: "you get a
 * heads-up when a worker on another floor starts waiting"): a toast naming the deck, and a chime.
 */
export function useOtherDecksHeadsUp(deckId: string): void {
  const { data: decks } = useSuspenseQuery(decksQuery);
  const others = decks.filter((d) => d.id !== deckId);
  const rosters = useQueries({ queries: others.map((d) => rosterQuery(d.id)) });
  const fresh = useRef(new Map<string, Fresh>());
  const crewKey = rosters.map((r) => r.dataUpdatedAt).join(",");

  useEffect(() => {
    others.forEach((deck, i) => {
      const crew = rosters[i]?.data;
      if (!crew) return;
      let seen = fresh.current.get(deck.id);
      if (!seen) fresh.current.set(deck.id, (seen = new Fresh()));
      const asking = seen.take(crew).filter((c) => c.status === "needs_input");
      if (!asking.length) return;
      const names = asking.map((c) => c.name).join(", ");
      useWorld
        .getState()
        .say(
          `🛗 ${names} on ${deck.name} ${asking.length > 1 ? "need" : "needs"} you: take the lift`,
        );
      playHeadsUp();
    });
    // Rosters are compared by when they last changed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [crewKey, deckId]);
}

/** Everyone hears when a cloned repo's deck opens (agent-office: "everyone hears when the floor opens"). */
export function useCloneNews(): void {
  const { data: clones } = useQuery(clonesQuery);
  const told = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!clones) return;
    const done = clones.filter((c) => c.state === "done");
    // Ones already open when the page came up aren't news.
    if (!told.current) {
      told.current = new Set(done.map((c) => c.id));
      return;
    }
    for (const c of done) {
      if (told.current.has(c.id)) continue;
      told.current.add(c.id);
      useWorld.getState().say(`🛗 Deck ${c.name.toUpperCase()} is open: take the lift`);
      playDone();
    }
  }, [clones]);
}
