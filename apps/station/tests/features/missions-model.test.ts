import { describe, expect, test } from "vite-plus/test";
import { parseCreateMissionInput, parseMissionIdInput } from "../../src/features/missions/model.ts";

const valid = {
  deckId: "d1",
  goal: "  Add dark mode  ",
  criteria: [
    { kind: "command", command: " vp test " },
    { kind: "manual", label: "Looks right" },
  ],
};

describe("parseCreateMissionInput", () => {
  test("accepts and trims a valid brief", () => {
    expect(parseCreateMissionInput({ ...valid, maxAttempts: 5 })).toEqual({
      deckId: "d1",
      goal: "Add dark mode",
      criteria: [
        { kind: "command", command: "vp test" },
        { kind: "manual", label: "Looks right" },
      ],
      maxAttempts: 5,
    });
  });

  test.each([
    ["a non-object", null, "Expected a mission brief"],
    ["a missing deck", { ...valid, deckId: "" }, "deckId is required"],
    ["an empty goal", { ...valid, goal: "   " }, "Goal is required"],
    ["a huge goal", { ...valid, goal: "x".repeat(4001) }, "Goal is too long"],
    ["no criteria", { ...valid, criteria: [] }, "Add at least one acceptance criterion"],
    [
      "too many criteria",
      { ...valid, criteria: Array(21).fill(valid.criteria[0]) },
      "At most 20 criteria",
    ],
    [
      "an unknown kind",
      { ...valid, criteria: [{ kind: "vibes" }] },
      "Criterion 1 must be a command or a manual check",
    ],
    [
      "an empty command",
      { ...valid, criteria: [{ kind: "command", command: " " }] },
      "Criterion 1 needs a command",
    ],
    [
      "an empty label",
      { ...valid, criteria: [{ kind: "manual", label: "" }] },
      "Criterion 1 needs a label",
    ],
    [
      "a fractional tank",
      { ...valid, maxAttempts: 1.5 },
      "maxAttempts must be a whole number from 1 to 10",
    ],
    [
      "a huge tank",
      { ...valid, maxAttempts: 50 },
      "maxAttempts must be a whole number from 1 to 10",
    ],
  ])("rejects %s", (_, input, message) => {
    expect(() => parseCreateMissionInput(input)).toThrow(message);
  });
});

describe("parseMissionIdInput", () => {
  test("accepts a mission id", () => {
    expect(parseMissionIdInput({ missionId: "m1" })).toEqual({ missionId: "m1" });
  });

  test("rejects anything else", () => {
    expect(() => parseMissionIdInput({})).toThrow("missionId is required");
  });
});
