import type { CrewInfo } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import {
  Fresh,
  NextUp,
  bannerText,
  byUrgency,
  needingYou,
  needyFirst,
  waited,
  waitingInOrder,
} from "../../src/features/world/waiting.ts";

function crew(id: string, patch: Partial<CrewInfo> = {}): CrewInfo {
  return {
    id,
    kind: "agent",
    deckId: "d",
    consoleId: 0,
    name: id,
    color: "#fff",
    character: "Mage",
    task: `task of ${id}`,
    status: "working",
    statusSince: 0,
    ...patch,
  };
}

describe("waiting on you", () => {
  test("needs-you first, then done, longest wait first", () => {
    const all = [
      crew("a", { status: "done", statusSince: 1 }),
      crew("b", { status: "needs_input", statusSince: 5 }),
      crew("c", { status: "working" }),
      crew("d", { status: "needs_input", statusSince: 2 }),
    ];
    expect(waitingInOrder(all).map((c) => c.id)).toEqual(["d", "b", "a"]);
    expect(needingYou(all).map((c) => c.id)).toEqual(["d", "b"]);
  });

  test("the Crew panel lists the ones that need you first, then by console", () => {
    const all = [
      crew("a", { consoleId: 3 }),
      crew("b", { consoleId: 1, status: "done" }),
      crew("c", { consoleId: 9, status: "needs_input" }),
    ];
    expect(needyFirst(all).map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  test("the 2D view: waiting first, then at work, then the rest, asleep last", () => {
    const all = [
      crew("asleep", { consoleId: 0, status: "asleep" }),
      crew("ready", { consoleId: 1, status: "idle" }),
      crew("busy", { consoleId: 2, status: "working" }),
      crew("done", { consoleId: 3, status: "done" }),
      crew("asks", { consoleId: 4, status: "needs_input" }),
    ];
    expect(byUrgency(all).map((c) => c.id)).toEqual(["asks", "done", "busy", "ready", "asleep"]);
  });

  test("waited reads nothing for a minute, then minutes, then hours", () => {
    expect(waited(0, 59_000)).toBe("");
    expect(waited(0, 4 * 60_000)).toBe("4 min");
    expect(waited(0, 65 * 60_000)).toBe("1 h 05 min");
  });

  test("the banner names the longest wait, what it asks and how many more", () => {
    const asking = [
      crew("Nova", { status: "needs_input", detail: "Wants permission: Bash: npm test" }),
      crew("Comet", { status: "needs_input" }),
    ];
    expect(bannerText(asking, 4 * 60_000)).toMatchObject({
      id: "Nova",
      title: "Nova needs you",
      detail: "Wants permission: Bash: npm test · 4 min",
      more: "+1 more",
    });
    expect(bannerText([], 0)).toBeNull();
  });

  test("Fresh reports status changes, not what was there at first sight", () => {
    const fresh = new Fresh();
    expect(fresh.take([crew("a", { status: "needs_input" })])).toEqual([]);
    expect(fresh.take([crew("a", { status: "needs_input" })])).toEqual([]);
    expect(fresh.take([crew("a", { status: "done" })]).map((c) => c.id)).toEqual(["a"]);
  });

  test("N visits each waiting crew member in turn, skipping where you stand", () => {
    const next = new NextUp();
    const all = [
      crew("a", { status: "needs_input", statusSince: 1 }),
      crew("b", { status: "done", statusSince: 2 }),
    ];
    expect(next.next(all)?.id).toBe("a");
    expect(next.next(all, "a")?.id).toBe("b");
    expect(next.next(all, "b")?.id).toBe("a");
    expect(next.next([crew("c")])).toBeUndefined();
  });
});
