import type { BriefInfo, PreflightInfo } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import { showsBriefPanel } from "../../src/features/world/scene/paint-brief.ts";
import { lampStates, showsPreflightPanel } from "../../src/features/world/scene/paint-preflight.ts";

const info = (over: Partial<PreflightInfo>): PreflightInfo => ({
  state: "running",
  checks: [{ name: "lint" }, { name: "test" }, { name: "build" }],
  attempt: 1,
  fuel: 3,
  maxFuel: 3,
  ...over,
});

describe("lampStates", () => {
  test("no info → all off", () => {
    expect(lampStates(undefined, 3)).toEqual(["off", "off", "off"]);
  });

  test("running second check → [go, running, off]", () => {
    const i = info({
      checks: [{ name: "lint", verdict: "go" }, { name: "test" }, { name: "build" }],
    });
    expect(lampStates(i, 3)).toEqual(["go", "running", "off"]);
  });

  test("nogo run → verdict colours", () => {
    const i = info({
      state: "nogo",
      checks: [
        { name: "lint", verdict: "go" },
        { name: "test", verdict: "nogo" },
        { name: "build", verdict: "skipped" },
      ],
    });
    expect(lampStates(i, 3)).toEqual(["go", "nogo", "off"]);
  });

  test("count larger than checks pads with off", () => {
    const i = info({
      state: "go",
      checks: [
        { name: "lint", verdict: "go" },
        { name: "test", verdict: "go" },
      ],
    });
    expect(lampStates(i, 4)).toEqual(["go", "go", "off", "off"]);
  });

  test("no info → all off", () => {
    expect(lampStates(undefined, 3)).toEqual(["off", "off", "off"]);
  });

  test("a manual-only run (attempt 0) still lights the lamps", () => {
    const i = info({ attempt: 0, state: "go", checks: [{ name: "lint", verdict: "go" }] });
    expect(lampStates(i, 2)).toEqual(["go", "off"]);
  });
});

describe("showsPreflightPanel", () => {
  test("running shows the panel", () => {
    expect(showsPreflightPanel(info({}), "working")).toBe(true);
  });
  test("nogo shows it only once the crew member stopped working", () => {
    expect(showsPreflightPanel(info({ state: "nogo" }), "working")).toBe(false);
    expect(showsPreflightPanel(info({ state: "nogo" }), "idle")).toBe(true);
  });
  test("a manual-only running run (attempt 0) shows the panel", () => {
    expect(showsPreflightPanel(info({ attempt: 0 }), "idle")).toBe(true);
  });
  test("go, cancelled and no info show the terminal", () => {
    expect(showsPreflightPanel(info({ state: "go" }), "idle")).toBe(false);
    expect(showsPreflightPanel(info({ state: "cancelled" }), "idle")).toBe(false);
    expect(showsPreflightPanel(undefined, "idle")).toBe(false);
  });
});

describe("showsBriefPanel", () => {
  const brief = (state: BriefInfo["state"]): BriefInfo => ({ revision: 1, state, goal: "g" });

  test("a waiting brief shows the panel", () => {
    expect(showsBriefPanel(brief("waiting"), "needs_input")).toBe(true);
  });

  test("an approved brief does not", () => {
    expect(showsBriefPanel(brief("approved"), "working")).toBe(false);
  });

  test("no brief does not", () => {
    expect(showsBriefPanel(undefined, undefined)).toBe(false);
  });
});
