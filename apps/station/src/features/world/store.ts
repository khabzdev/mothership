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
  | { kind: "lift"; fromLift?: boolean };

interface WorldState {
  /** Console the Captain is standing at. */
  consoleId: number | null;
  /** Standing at the lift doors. */
  atLift: boolean;
  /** Standing at a board. */
  atBoard: BoardId | null;
  overlay: Overlay | null;
  setConsole: (id: number | null) => void;
  setAtLift: (atLift: boolean) => void;
  setAtBoard: (atBoard: BoardId | null) => void;
  open: (overlay: Overlay) => void;
  close: () => void;
  say: (text: string) => void;
}

/** Game-wide UI state shared by the 3D scene and the DOM overlays. */
export const useWorld = create<WorldState>((set) => ({
  consoleId: null,
  atLift: false,
  atBoard: null,
  overlay: null,
  setConsole: (consoleId) => set((s) => (s.consoleId === consoleId ? s : { consoleId })),
  setAtLift: (atLift) => set((s) => (s.atLift === atLift ? s : { atLift })),
  setAtBoard: (atBoard) => set((s) => (s.atBoard === atBoard ? s : { atBoard })),
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  // A short message (agent-office's toasts), as a Kumo toast.
  say: (text) => notify(text),
}));

/** Game keys are ignored while typing or while a window is open (agent-office's guard). */
export function gameKeysEnabled(event: KeyboardEvent): boolean {
  if (useWorld.getState().overlay) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  return !(
    target &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest(".xterm"))
  );
}
