export const MISSION_STATES = [
  "briefing",
  "building",
  "preflight",
  "launched",
  "redAlert",
] as const;

export type MissionState = (typeof MISSION_STATES)[number];
