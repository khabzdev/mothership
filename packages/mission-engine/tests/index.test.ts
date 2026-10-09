import { expect, test } from "vite-plus/test";
import { MISSION_STATES } from "../src/index.ts";

test("exposes the mission lifecycle states", () => {
  expect(MISSION_STATES).toEqual(["briefing", "building", "preflight", "launched", "redAlert"]);
});
