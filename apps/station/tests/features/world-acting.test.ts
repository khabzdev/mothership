import { describe, expect, test } from "vite-plus/test";
import { ACT_MIN, ActHold, DESPAIR_MIN, actFor } from "../../src/features/world/acting.ts";

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
});
