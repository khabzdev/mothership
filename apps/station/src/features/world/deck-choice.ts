import { useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { decksQuery } from "../decks/queries";

const KEY = "mothership.deck";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Which deck you're on (remembered per browser); falls back to the first deck. */
export function useDeckChoice() {
  const { data: decks } = useSuspenseQuery(decksQuery);
  const stored = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
    () => null,
  );
  const deck = decks.find((d) => d.id === stored) ?? decks[0] ?? null;
  const choose = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // remembered for this session only
    }
    for (const notify of listeners) notify();
  }, []);
  return { deck, deckId: deck?.id ?? null, choose };
}
