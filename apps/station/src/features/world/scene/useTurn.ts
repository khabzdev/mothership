import type { PreflightInfo } from "@mothership/protocol";
import { useEffect, useRef, useState } from "react";
import { isGo, isNoGo } from "../../preflight/poll";

/**
 * When a pre-flight turns GO or NO-GO: the time (ms since epoch) of that transition, or 0.
 * Only changes seen after mount count, so a deck loaded already GO doesn't cheer.
 */
export function usePreflightTurn(info: PreflightInfo | undefined, to: "go" | "nogo"): number {
  const now = to === "go" ? isGo(info) : isNoGo(info);
  const was = useRef(now);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (now && !was.current) setAt(Date.now());
    was.current = now;
  }, [now]);
  return at;
}

/**
 * Whether `ms` haven't yet passed since `since` (0: never); re-renders when they have, so what
 * it gates unmounts on time instead of lingering.
 */
export function useFor(since: number, ms: number): boolean {
  const [, rerender] = useState(0);
  useEffect(() => {
    const wait = since + ms - Date.now();
    if (since <= 0 || wait <= 0) return;
    const timer = setTimeout(() => rerender((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [since, ms]);
  return since > 0 && Date.now() - since < ms;
}
