// Your ship: the take-off and landing that carry you between decks (pure, so tests can drive it).

/** Seconds: rumbling on the pad, climbing away, and coming down on the new deck. */
export const SHIP_TIMING = { rumble: 0.4, climb: 1.2, land: 1.0 } as const;
/** How high (m) the ship climbs before it's out of sight. */
export const CLIMB_HEIGHT = 30;

export interface ShipPose {
  /** Height above the pad (m). */
  y: number;
  /** How hard it shakes on the pad (m). */
  shake: number;
  /** Thrust flame, 0 (off) to 1 (full). */
  flame: number;
  /** Escape still calls it off. */
  cancellable: boolean;
  done: boolean;
}

const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

/** A fresh pose to fill (the scene keeps one and passes it to `shipPose` every frame). */
export function restingPose(): ShipPose {
  return { y: 0, shake: 0, flame: 0, cancellable: false, done: true };
}

/** Where the ship is `t` seconds into a take-off or a landing (written into `out`, if given). */
export function shipPose(
  phase: "takeoff" | "landing",
  t: number,
  out: ShipPose = restingPose(),
): ShipPose {
  const { rumble, climb, land } = SHIP_TIMING;
  if (phase === "landing") {
    const k = Math.min(1, Math.max(0, t / land));
    out.y = CLIMB_HEIGHT * 0.5 * (1 - easeOut(k));
    out.shake = 0;
    out.flame = 1 - k;
    out.cancellable = false;
    out.done = t >= land;
  } else if (t < rumble) {
    out.y = 0;
    out.shake = 0.03;
    out.flame = 0.6 * Math.max(0, t / rumble);
    out.cancellable = true;
    out.done = false;
  } else {
    out.y = CLIMB_HEIGHT * easeIn(Math.min(1, (t - rumble) / climb));
    out.shake = 0;
    out.flame = 1;
    out.cancellable = false;
    out.done = t >= rumble + climb;
  }
  return out;
}

/** Escape calls a flight off only while the ship is still rumbling on the pad. */
export function canCancel(flight: { at: number } | null, now: number): boolean {
  return !!flight && shipPose("takeoff", (now - flight.at) / 1000).cancellable;
}

/**
 * When the take-off ends: fly on to the picked deck, or just end the flight. It ends when the deck
 * switched some other way mid-flight (top bar, palette) or the picked deck is gone.
 */
export function flightOutcome(
  flight: { to: string; from: string | null },
  current: string | null,
  deckIds: readonly string[],
): "fly" | "end" {
  return current === flight.from && deckIds.includes(flight.to) ? "fly" : "end";
}

/**
 * Picking a deck in the Flight plan: from your ship you fly there; from the top bar or the
 * palette you switch straight over; your own deck keeps you where you are.
 */
export function rideAction(
  fromShip: boolean,
  id: string,
  current: string | null,
): "fly" | "choose" | "stay" {
  if (id === current) return "stay";
  return fromShip ? "fly" : "choose";
}

/**
 * After the target deck's data is warm: land on it only if the flight is still the one we started
 * and you're still on the deck you left. Otherwise something else took over, so drop it.
 */
export function afterPrefetch(
  flight: { at: number; from: string | null } | null,
  startedAt: number,
  currentDeckId: string | null,
): "land" | "drop" {
  return flight !== null && flight.at === startedAt && currentDeckId === flight.from
    ? "land"
    : "drop";
}

/** Settles with `promise`, or with `undefined` after `ms` (rejections count as settling too). */
export function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}
