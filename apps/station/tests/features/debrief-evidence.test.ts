import { describe, expect, test } from "vite-plus/test";
import {
  clipEvidence,
  evidenceSummary,
  missionHadTrouble,
  type MissionEvidence,
} from "../../src/features/debrief/evidence.ts";

const empty: MissionEvidence = { task: "Fix login", nogo: [], flagged: [], revised: [] };

describe("missionHadTrouble", () => {
  test("is false for a clean mission", () => {
    expect(missionHadTrouble(empty)).toBe(false);
  });

  test.each([
    ["a NO-GO", { nogo: [{ checks: ["test"], tails: [] }] }],
    ["a flagged finding", { flagged: [{ title: "Bug", why: "w" }] }],
    ["a revised brief", { revised: [{ goal: "g", reason: "r" }] }],
  ])("is true for %s", (_, patch) => {
    expect(missionHadTrouble({ ...empty, ...patch })).toBe(true);
  });
});

describe("clipEvidence", () => {
  const bytes = (s: string) => Buffer.byteLength(s);

  test("caps each tail at 1.5 KB", () => {
    const out = clipEvidence({ ...empty, nogo: [{ checks: ["t"], tails: ["a".repeat(5000)] }] });
    expect(bytes(out.nogo[0]!.tails[0]!)).toBe(1536);
  });

  test("caps all tails at 4 KB", () => {
    const tails = ["a", "b", "c", "d"].map((c) => c.repeat(1536));
    const out = clipEvidence({ ...empty, nogo: [{ checks: ["t"], tails }] });
    const total = out.nogo[0]!.tails.reduce((n, t) => n + bytes(t), 0);
    expect(total).toBe(4096);
    expect(out.nogo[0]!.tails[2]).toHaveLength(1024);
    expect(out.nogo[0]!.tails[3]).toBe("");
  });

  test("cuts on code points", () => {
    const out = clipEvidence({ ...empty, nogo: [{ checks: ["t"], tails: ["😀".repeat(1000)] }] });
    const tail = out.nogo[0]!.tails[0]!;
    expect(bytes(tail)).toBeLessThanOrEqual(1536);
    expect(tail).not.toContain("�");
    expect(Array.from(tail).every((c) => c === "😀")).toBe(true);
  });

  test("keeps everything else", () => {
    const e = { ...empty, flagged: [{ title: "Bug", why: "w" }] };
    expect(clipEvidence(e)).toEqual(e);
  });
});

describe("evidenceSummary", () => {
  test("joins what went wrong on one line", () => {
    const line = evidenceSummary({
      task: "t",
      nogo: [{ checks: ["test"], tails: [] }],
      flagged: [{ title: "Missing null check", why: "w" }],
      revised: [{ goal: "g", reason: "scope too wide" }],
    });
    expect(line).toBe("NO-GO: test · Inspector: Missing null check · revised: scope too wide");
  });

  test("is empty for a clean mission", () => {
    expect(evidenceSummary(empty)).toBe("");
  });

  test("stays within 140 characters", () => {
    const line = evidenceSummary({ ...empty, flagged: [{ title: "x".repeat(400), why: "w" }] });
    expect(Array.from(line)).toHaveLength(140);
    expect(line.endsWith("…")).toBe(true);
  });
});
