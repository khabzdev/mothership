import { create } from "zustand";

export type Overlay =
  | { kind: "hire"; consoleId: number; withTask: boolean }
  | { kind: "prompt"; crewId: string }
  | { kind: "terminal"; crewId: string }
  | { kind: "sendHome"; crewId: string }
  | { kind: "changes"; crewId: string }
  | { kind: "pr"; crewId: string }
  | { kind: "lift" };

interface WorldState {
  /** Console the Captain is standing at. */
  consoleId: number | null;
  overlay: Overlay | null;
  /** A short message over the hint bar (agent-office's toasts). */
  toast: { text: string; at: number } | null;
  setConsole: (id: number | null) => void;
  open: (overlay: Overlay) => void;
  close: () => void;
  say: (text: string) => void;
}

/** Game-wide UI state shared by the 3D scene and the DOM overlays. */
export const useWorld = create<WorldState>((set) => ({
  consoleId: null,
  overlay: null,
  toast: null,
  setConsole: (consoleId) => set((s) => (s.consoleId === consoleId ? s : { consoleId })),
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  say: (text) => set({ toast: { text, at: Date.now() } }),
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
