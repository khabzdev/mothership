import type { BoardCard } from "../world/scene/Board";
import type { QueueTask } from "./queue.server";

/** The queue whiteboard: what's running (and who's on it), then what's next. */
export function queueCards(
  tasks: QueueTask[] | undefined,
  limit: number,
): { cards: BoardCard[]; note: string } {
  const all = tasks ?? [];
  const running = all.filter((t) => t.state === "running");
  const queued = all.filter((t) => t.state === "queued");
  return {
    cards: [
      ...running.map((t) => ({
        key: t.id,
        label: t.crewName ?? "crew",
        title: t.title,
        color: "#c6e2ff",
        dot: "#ffd166",
      })),
      ...queued.map((t, i) => ({
        key: t.id,
        label: `next ${i + 1}`,
        title: t.title,
        color: "#fff1b8",
      })),
    ],
    note: limit === 0 ? "paused" : `${running.length}/${limit} running · ${queued.length} queued`,
  };
}
