import { describe, expect, test } from "vite-plus/test";
import {
  ACT_MIN,
  ActHold,
  DESPAIR_MIN,
  actFor,
  stanceFor,
} from "../../src/features/world/acting.ts";

describe("acting", () => {
  test("working crew act out their tool call, or type", () => {
    expect(actFor({ status: "working", action: "read" })).toBe("read");
    expect(actFor({ status: "working" })).toBe("type");
    expect(actFor({ status: "idle", action: "edit" })).toBe("rest");
  });

  test("an act is held for a moment so quick tool calls don't flicker", () => {
    const hold = new ActHold();
    expect(hold.at("read", 0)).toBe("read");
    expect(hold.at("edit", 0.5)).toBe("read");
    expect(hold.at("edit", ACT_MIN)).toBe("edit");
  });

  test("head in hands lasts longer, but stopping work shows at once", () => {
    const hold = new ActHold();
    hold.at("failing", 0);
    expect(hold.at("edit", ACT_MIN)).toBe("failing");
    expect(hold.at("edit", DESPAIR_MIN)).toBe("edit");
    expect(hold.at("rest", DESPAIR_MIN + 0.1)).toBe("rest");
  });

  test("done crew cheer only once nothing is left to prove", () => {
    const cheer = { clip: "Cheer", seated: false };
    const sit = { clip: "Sit_Chair_Idle", seated: true };
    const done = (state?: "running" | "go" | "nogo" | "cancelled") => ({
      status: "done" as const,
      ...(state && {
        preflight: { state, checks: [], attempt: 1, fuel: 3, maxFuel: 3 },
      }),
    });
    expect(stanceFor(done())).toEqual(cheer);
    expect(stanceFor(done("go"))).toEqual(cheer);
    expect(stanceFor(done("cancelled"))).toEqual(cheer);
    expect(stanceFor(done("running"))).toEqual(sit);
    expect(stanceFor(done("nogo"))).toEqual(sit);
    expect(stanceFor({ status: "needs_input" })).toEqual({
      clip: "Spellcast_Raise",
      seated: false,
    });
    expect(stanceFor({ status: "working" })).toEqual(sit);
  });
});
