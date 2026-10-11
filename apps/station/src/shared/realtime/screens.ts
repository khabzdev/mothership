import type { ScreenFrame } from "@spaceship/protocol";

// The latest screen of each crew terminal, kept outside the Query cache: frames arrive several
// times a second and are painted straight onto canvases, never rendered by React.

const frames = new Map<string, { frame: ScreenFrame; version: number }>();
const listeners = new Map<string, Set<() => void>>();
let version = 0;

export function setScreen(crewId: string, frame: ScreenFrame): void {
  frames.set(crewId, { frame, version: ++version });
  for (const listener of listeners.get(crewId) ?? []) listener();
}

/** A crew member's last screen, and a number that changes whenever it does. */
export function getScreen(crewId: string): { frame: ScreenFrame; version: number } | undefined {
  return frames.get(crewId);
}

export function onScreen(crewId: string, listener: () => void): () => void {
  const set = listeners.get(crewId) ?? new Set();
  set.add(listener);
  listeners.set(crewId, set);
  return () => set.delete(listener);
}
