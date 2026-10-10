import { describe, expect, test } from "vite-plus/test";
import {
  flaggedDetail,
  inspectionChip,
  inspectionHandBack,
  parseCrewInspectInput,
  parseInspectorInput,
  prInspection,
  type Finding,
} from "../../src/features/inspection/model.ts";

const blocker: Finding = {
  severity: "blocker",
  source: "review",
  file: "a.ts",
  line: 3,
  title: "T",
  why: "W",
};
const note: Finding = {
  severity: "note",
  source: "scope",
  file: "src/api.ts",
  line: 40,
  title: "Large change: 512 lines",
  why: "w",
};

describe("inspectionHandBack", () => {
  test("lists blockers only", () => {
    const text = inspectionHandBack(
      [
        blocker,
        { ...blocker, line: undefined, title: "U", why: "V" },
        { ...blocker, file: undefined, line: undefined, title: "X", why: "Y" },
        note,
      ],
      2,
      4,
    );
    expect(text.startsWith("Inspector flagged your change (attempt 2 of 4):")).toBe(true);
    expect(text).toContain("✗ a.ts:3 T — W");
    expect(text).toContain("✗ a.ts U — V");
    expect(text).toContain("✗ X — Y");
    expect(text).not.toContain("Large change");
    expect(text).toContain(
      "Fix these, then stop. Pre-flight and the Inspector run again when you stop.",
    );
  });
});

describe("flaggedDetail", () => {
  test("names the first blocker", () => {
    expect(flaggedDetail([note, blocker])).toBe("Inspector flagged: T");
  });
});

describe("prInspection", () => {
  const base = { attempt: 2, commit: "abc1234def", fingerprint: "h1" };
  test("cleared", () => {
    const md = prInspection({ ...base, state: "cleared", findings: [note] });
    expect(md).toContain("## Inspection: Cleared  (attempt 2 · commit abc1234)");
    expect(md).toContain("- note · src/api.ts:40 — Large change: 512 lines");
    expect(md).not.toContain("earlier state");
  });
  test("flagged lists blockers first and flags stale state", () => {
    const md = prInspection(
      { ...base, state: "flagged", findings: [note, blocker] },
      { hash: "h2" },
    );
    expect(md).toContain("## Inspection: Flagged");
    expect(md.indexOf("blocker · a.ts:3")).toBeLessThan(md.indexOf("note · src/api.ts:40"));
    expect(md).toContain("_Inspected an earlier state of this branch._");
    expect(
      prInspection({ ...base, state: "flagged", findings: [blocker] }, { hash: "h1" }),
    ).not.toContain("earlier state");
  });
});

describe("inspectionChip", () => {
  const info = (state: "running" | "cleared" | "flagged" | "cancelled") => ({
    state,
    blockers: 0,
    notes: 0,
  });
  test("per state", () => {
    expect(inspectionChip(info("running"))).toEqual({ label: "Inspecting…", tone: "warning" });
    expect(inspectionChip(info("cleared"))).toEqual({ label: "Cleared", tone: "success" });
    expect(inspectionChip(info("flagged"))).toEqual({ label: "Flagged", tone: "error" });
    expect(inspectionChip(info("cancelled"))).toBeNull();
    expect(inspectionChip(undefined)).toBeNull();
  });
});

describe("inputs", () => {
  test("parse", () => {
    expect(parseCrewInspectInput({ crewId: " c1 " })).toEqual({ crewId: "c1" });
    expect(() => parseCrewInspectInput({})).toThrow();
    expect(parseInspectorInput({ deckId: "d", on: false })).toEqual({ deckId: "d", on: false });
    expect(() => parseInspectorInput({ deckId: "d", on: "yes" })).toThrow();
    expect(() => parseInspectorInput({ on: true })).toThrow();
  });
});
