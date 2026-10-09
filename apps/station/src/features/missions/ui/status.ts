import type { Alert, Mission, MissionState } from "@mothership/mission-engine";

export type LampTone = "idle" | "active" | "check" | "launch" | "go" | "alert";

const STATE_LAMPS: Record<Exclude<MissionState, "redAlert">, { label: string; tone: LampTone }> = {
  briefing: { label: "Briefing", tone: "idle" },
  building: { label: "Building", tone: "active" },
  preflight: { label: "Pre-flight", tone: "check" },
  launching: { label: "Launching", tone: "launch" },
  launched: { label: "Launched", tone: "go" },
};

const ALERT_LABELS: Record<Alert["reason"], string> = {
  needsInput: "Needs you",
  crashed: "Crashed",
  outOfFuel: "Out of fuel",
  launchFailed: "Launch failed",
};

/** The status lamp shown on a mission card. */
export function missionLamp(mission: Mission): { label: string; tone: LampTone } {
  if (mission.state === "redAlert") {
    return {
      label: mission.alert ? ALERT_LABELS[mission.alert.reason] : "Red alert",
      tone: "alert",
    };
  }
  return STATE_LAMPS[mission.state];
}

/** Fuel gauge segments: one per allowed attempt, burnt ones first. */
export function fuelGauge(mission: Mission): ("burnt" | "full")[] {
  const burnt = Math.min(mission.attempts, mission.maxAttempts);
  return Array.from({ length: mission.maxAttempts }, (_, i) => (i < burnt ? "burnt" : "full"));
}
