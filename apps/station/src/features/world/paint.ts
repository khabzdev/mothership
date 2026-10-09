// Each deck's own colours (agent-office's per-floor wall and floor colours), so you always know
// which repo you're on. Picked from the repo's path, so a deck keeps its paint across restarts.

export interface DeckPaint {
  name: string;
  floor: string;
  grid: [string, string];
  wall: string;
  trim: string;
}

export const DECK_PAINTS: DeckPaint[] = [
  {
    name: "Ember",
    floor: "#3a3f4b",
    grid: ["#596173", "#4a5060"],
    wall: "#d9dde6",
    trim: "#ff5f1f",
  },
  {
    name: "Reef",
    floor: "#2f4247",
    grid: ["#4d6a70", "#3f575c"],
    wall: "#d6e6e4",
    trim: "#2ec4b6",
  },
  {
    name: "Nebula",
    floor: "#3b3550",
    grid: ["#5b5378", "#4a4363"],
    wall: "#e2dcef",
    trim: "#9b5de5",
  },
  {
    name: "Solar",
    floor: "#45403a",
    grid: ["#6b6255", "#575046"],
    wall: "#efe6d6",
    trim: "#ffd166",
  },
  {
    name: "Glacier",
    floor: "#344457",
    grid: ["#52688a", "#435670"],
    wall: "#dde6f2",
    trim: "#5aa9ff",
  },
  {
    name: "Moss",
    floor: "#36443a",
    grid: ["#55695a", "#465749"],
    wall: "#dfe8dc",
    trim: "#06d6a0",
  },
  {
    name: "Rose",
    floor: "#46363d",
    grid: ["#6b5560", "#58464f"],
    wall: "#f0dfe4",
    trim: "#ef476f",
  },
  {
    name: "Copper",
    floor: "#453a34",
    grid: ["#6b5a50", "#574a42"],
    wall: "#efe1d8",
    trim: "#f78c6b",
  },
];

/** The deck's paint, picked by a stable hash of its repo path. */
export function paintFor(repoPath: string): DeckPaint {
  let h = 2166136261;
  for (let i = 0; i < repoPath.length; i++) h = Math.imul(h ^ repoPath.charCodeAt(i), 16777619);
  return DECK_PAINTS[(h >>> 0) % DECK_PAINTS.length]!;
}
