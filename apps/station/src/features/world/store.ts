import { create } from "zustand";
import type { BoardId } from "./layout";
import { notify, type Tone } from "../../shared/ui/toasts";

export type Overlay =
  | { kind: "hire"; consoleId: number; withTask: boolean }
  | { kind: "prompt"; crewId: string }
  | { kind: "terminal"; crewId: string }
  | { kind: "sendHome"; crewId: string }
  | { kind: "changes"; crewId: string }
  | { kind: "pr"; crewId: string }
  | { kind: "preflight"; crewId: string }
  | { kind: "brief"; crewId: string }
  | { kind: "launchCheck"; crewId: string; reason: string }
  | { kind: "label"; consoleId: number }
  | { kind: "board"; board: BoardId; open?: number }
  | { kind: "flight"; fromShip?: boolean }
  | { kind: "search" }
  | { kind: "flightControl" };

interface WorldState {
  /** Console the Captain is standing at. */
  consoleId: number | null;
  /** Standing in front of your ship. */
  atShip: boolean;
  /** Your ship taking off from deck `from` for deck `to` (`at`: when you picked it, ms). */
  flight: { to: string; from: string | null; at: number; navigating?: boolean } | null;
  /** Your ship has just flown you here and is coming down on the pad. */
  arriving: boolean;
  /** Standing at the Flight Control desk. */
  atFlightControl: boolean;
  /** The last pull request launched on this deck, for the klaxon, rocket and confetti. */
  launch: { number: number; title: string; crewId?: string; at: number } | null;
  /** Everyone's on their feet cheering a launch. */
  cheering: boolean;
  /** An issue's card in your hands (agent-office's carried note), on its way to a console. */
  carrying: { number: number; title: string } | null;
  /** The command palette is up (Ctrl+K). */
  paletteOpen: boolean;
  /** Standing at a board. */
  atBoard: BoardId | null;
  overlay: Overlay | null;
  setConsole: (id: number | null) => void;
  setAtShip: (atShip: boolean) => void;
  startFlight: (to: string, from: string | null) => void;
  cancelFlight: () => void;
  endFlight: () => void;
  /** The take-off ended and the deck switch is under way (so a remounted pad doesn't repeat it). */
  markNavigating: (at: number) => void;
  setArriving: (arriving: boolean) => void;
  setAtFlightControl: (atFlightControl: boolean) => void;
  setAtBoard: (atBoard: BoardId | null) => void;
  setPalette: (open: boolean) => void;
  carry: (card: { number: number; title: string } | null) => void;
  celebrate: (launch: { number: number; title: string; crewId?: string }) => void;
  open: (overlay: Overlay) => void;
  close: () => void;
  /** A short message; `tone` colours it (errors linger). */
  say: (text: string, tone?: Tone) => void;
}

/** How long the crew cheer a launch (ms). */
export const CHEER_MS = 6000;

/** Game-wide UI state shared by the 3D scene and the DOM overlays. */
export const useWorld = create<WorldState>((set) => ({
  consoleId: null,
  atShip: false,
  flight: null,
  arriving: false,
  atFlightControl: false,
  atBoard: null,
  launch: null,
  cheering: false,
  carrying: null,
  paletteOpen: false,
  overlay: null,
  setConsole: (consoleId) => set((s) => (s.consoleId === consoleId ? s : { consoleId })),
  setAtShip: (atShip) => set((s) => (s.atShip === atShip ? s : { atShip })),
  startFlight: (to, from) => set({ flight: { to, from, at: Date.now() } }),
  cancelFlight: () => set({ flight: null }),
  endFlight: () => set({ flight: null }),
  markNavigating: (at) =>
    set((s) => (s.flight?.at === at ? { flight: { ...s.flight, navigating: true } } : s)),
  setArriving: (arriving) => set({ arriving }),
  setAtFlightControl: (atFlightControl) =>
    set((s) => (s.atFlightControl === atFlightControl ? s : { atFlightControl })),
  setAtBoard: (atBoard) => set((s) => (s.atBoard === atBoard ? s : { atBoard })),
  carry: (carrying) => set({ carrying }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  celebrate: (launch) => {
    const at = Date.now();
    set({ launch: { ...launch, at }, cheering: true });
    // Back in their seats once the rocket's gone.
    setTimeout(() => set((s) => (s.launch?.at === at ? { cheering: false } : s)), CHEER_MS);
  },
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  // A short message (agent-office's toasts), as a Kumo toast.
  say: (text, tone) => notify(text, tone),
}));

/** Aboard your ship: taking off, or coming down on a new deck. */
export function aboard(): boolean {
  const { flight, arriving } = useWorld.getState();
  return flight !== null || arriving;
}

/** Game keys are ignored while typing or while a window is open (agent-office's guard). */
export function gameKeysEnabled(event: KeyboardEvent): boolean {
  const { overlay, paletteOpen } = useWorld.getState();
  // Aboard your ship you're not walking the deck.
  if (overlay || paletteOpen || aboard()) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  // Keys sent to the window or document (not an element) are game keys too.
  const target = event.target instanceof HTMLElement ? event.target : null;
  return !(
    target &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest(".xterm"))
  );
}
