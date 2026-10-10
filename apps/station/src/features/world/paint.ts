// Each deck's own trim colour (agent-office's per-floor colours), so you always know
// which repo you're on. Picked from the repo's path, so a deck keeps its paint across restarts.

export interface DeckPaint {
  name: string;
  trim: string;
}

export const DECK_PAINTS: DeckPaint[] = [
  {
    name: "Ember",
    trim: "#ff5f1f",
  },
  {
    name: "Reef",
    trim: "#2ec4b6",
  },
  {
    name: "Nebula",
    trim: "#9b5de5",
  },
  {
    name: "Solar",
    trim: "#ffd166",
  },
  {
    name: "Glacier",
    trim: "#5aa9ff",
  },
  {
    name: "Moss",
    trim: "#06d6a0",
  },
  {
    name: "Rose",
    trim: "#ef476f",
  },
  {
    name: "Copper",
    trim: "#f78c6b",
  },
];

/** The deck's paint, picked by a stable hash of its repo path. */
export function paintFor(repoPath: string): DeckPaint {
  let h = 2166136261;
  for (let i = 0; i < repoPath.length; i++) h = Math.imul(h ^ repoPath.charCodeAt(i), 16777619);
  return DECK_PAINTS[(h >>> 0) % DECK_PAINTS.length]!;
}
