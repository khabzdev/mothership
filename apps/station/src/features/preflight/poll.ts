import type { CheckVerdict, PreflightInfo, ServerMsg } from "@mothership/protocol";

export type PreflightMsg = Extract<ServerMsg, { type: "crew.preflight" }>;

/** This deck's pre-flight messages; anything else (other decks, other message types) is null. */
export function forDeck(msg: ServerMsg, deckId: string): PreflightMsg | null {
  return msg.type === "crew.preflight" && msg.deckId === deckId ? msg : null;
}

/** What Flight Control calls out for one check; null when it stays quiet (skipped). */
export function pollLine(e: {
  check: string;
  verdict: CheckVerdict;
  done: boolean;
  allGo: boolean;
  deck: string;
  crew: string;
}): string | null {
  if (e.verdict === "skipped") return null;
  const name = e.check.charAt(0).toUpperCase() + e.check.slice(1);
  const line = `${name}… ${e.verdict === "go" ? "GO" : "NO-GO"}.`;
  return e.done && e.allGo ? `${line} ${e.deck}, ${e.crew}: all stations GO.` : line;
}

/** A GO light: the run is GO and has actually run (`attempt === 0` counts as not run). */
export function isGo(info: PreflightInfo | undefined): boolean {
  return info?.state === "go" && info.attempt > 0;
}
