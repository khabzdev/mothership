import { create } from "zustand";
import type { BoardId } from "./layout";
import { notify } from "../../shared/ui/toasts";

export type Overlay =
  | { kind: "hire"; consoleId: number; withTask: boolean }
  | { kind: "prompt"; crewId: string }
  | { kind: "terminal"; crewId: string }
  | { kind: "sendHome"; crewId: string }
  | { kind: "changes"; crewId: string }
  | { kind: "pr"; crewId: string }
  | { kind: "label"; consoleId: number }
  | { kind: "board"; board: BoardId; open?: number }
  | { kind: "lift"; fromLift?: boolean }
  | { kind: "search" };

interface WorldState {
  /** Console the Captain is standing at. */
  consoleId: number | null;
  /** Standing at the lift doors. */
  atLift: boolean;
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
  setAtLift: (atLift: boolean) => void;
  setAtBoard: (atBoard: BoardId | null) => void;
  setPalette: (open: boolean) => void;
  carry: (card: { number: number; title: string } | null) => void;
  celebrate: (launch: { number: number; title: string; crewId?: string }) => void;
  open: (overlay: Overlay) => void;
  close: () => void;
  say: (text: string) => void;
}

/** How long the crew cheer a launch (ms). */
export const CHEER_MS = 6000;

/** Game-wide UI state shared by the 3D scene and the DOM overlays. */
export const useWorld = create<WorldState>((set) => ({
  consoleId: null,
  atLift: false,
  atBoard: null,
  launch: null,
  cheering: false,
  carrying: null,
  paletteOpen: false,
  overlay: null,
  setConsole: (consoleId) => set((s) => (s.consoleId === consoleId ? s : { consoleId })),
  setAtLift: (atLift) => set((s) => (s.atLift === atLift ? s : { atLift })),
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
  say: (text) => notify(text),
}));

/** Game keys are ignored while typing or while a window is open (agent-office's guard). */
export function gameKeysEnabled(event: KeyboardEvent): boolean {
  const { overlay, paletteOpen } = useWorld.getState();
  if (overlay || paletteOpen) return false;
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
