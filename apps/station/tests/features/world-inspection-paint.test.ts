import type { InspectionInfo } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import {
  paintInspection,
  showsInspectionPanel,
} from "../../src/features/world/scene/paint-inspection.ts";

const info = (over: Partial<InspectionInfo> = {}): InspectionInfo => ({
  state: "running",
  blockers: 0,
  notes: 0,
  ...over,
});

/** A 2D context that records the text painted on it. */
function stubContext() {
  const texts: string[] = [];
  const ctx = {
    fillRect() {},
    fillText(text: string) {
      texts.push(text);
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    beginPath() {},
    arc() {},
    fill() {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("showsInspectionPanel", () => {
  test("running shows, even while working", () => {
    expect(showsInspectionPanel(info(), "working")).toBe(true);
    expect(showsInspectionPanel(info(), "idle")).toBe(true);
  });

  test("a verdict shows only once the crew member isn't working", () => {
    for (const state of ["cleared", "flagged"] as const) {
      expect(showsInspectionPanel(info({ state }), "working")).toBe(false);
      expect(showsInspectionPanel(info({ state }), "idle")).toBe(true);
    }
  });

  test("cancelled and no inspection show the terminal", () => {
    expect(showsInspectionPanel(info({ state: "cancelled" }), "idle")).toBe(false);
    expect(showsInspectionPanel(undefined, "idle")).toBe(false);
  });
});

describe("paintInspection", () => {
  test("running: scanning", () => {
    const { ctx, texts } = stubContext();
    paintInspection(ctx, 1024, 584, info(), false);
    expect(texts).toEqual(["INSPECTION", "Scanning…"]);
  });

  test("queued: waiting its turn", () => {
    const { ctx, texts } = stubContext();
    paintInspection(ctx, 1024, 584, info({ queued: true }), false);
    expect(texts).toEqual(["INSPECTION", "Queued…"]);
  });

  test("cleared with notes", () => {
    const { ctx, texts } = stubContext();
    paintInspection(ctx, 1024, 584, info({ state: "cleared", notes: 2 }), false);
    expect(texts).toEqual(["INSPECTION", "Cleared · 2 notes"]);
  });

  test("cleared with one note, or none", () => {
    const one = stubContext();
    paintInspection(one.ctx, 1024, 584, info({ state: "cleared", notes: 1 }), false);
    expect(one.texts).toContain("Cleared · 1 note");
    const none = stubContext();
    paintInspection(none.ctx, 1024, 584, info({ state: "cleared" }), false);
    expect(none.texts).toContain("Cleared");
  });

  test("flagged: the count and the first blocker's title", () => {
    const { ctx, texts } = stubContext();
    const flagged = info({ state: "flagged", blockers: 1, firstBlocker: "Drops the auth check" });
    paintInspection(ctx, 1024, 584, flagged, false);
    expect(texts).toEqual(["INSPECTION", "Flagged · 1 blocker", "Drops the auth check"]);
  });

  test("two blockers read plural", () => {
    const { ctx, texts } = stubContext();
    paintInspection(ctx, 1024, 584, info({ state: "flagged", blockers: 2 }), false);
    expect(texts).toContain("Flagged · 2 blockers");
  });

  test("the I key only when you stand at the console", () => {
    const { ctx, texts } = stubContext();
    paintInspection(ctx, 1024, 584, info({ state: "cleared", notes: 2 }), true);
    expect(texts.at(-1)).toBe("I report");
  });
});
