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
