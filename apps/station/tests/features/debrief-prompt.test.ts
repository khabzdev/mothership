import { describe, expect, test } from "vite-plus/test";
import type { MissionEvidence } from "../../src/features/debrief/evidence.ts";
import { debriefPrompt, parseDebrief } from "../../src/features/debrief/prompt.ts";

const evidence: MissionEvidence = {
  task: "Fix login",
  nogo: [{ checks: ["test"], tails: ["1 failed"] }],
  flagged: [{ title: "Missing null check", file: "a.ts", why: "can crash" }],
  revised: [{ goal: "Fix login", reason: "too broad" }],
};
const envelope = (result: string) => JSON.stringify({ type: "result", result });
const fenced = (body: unknown) => envelope("```json\n" + JSON.stringify(body) + "\n```");

describe("debriefPrompt", () => {
  test("carries the kept lessons and the evidence", () => {
    const p = debriefPrompt(evidence, ["Run vp check first."]);
    expect(p).toContain("- Run vp check first.");
    expect(p).toContain("Fix login");
    expect(p).toContain("1 failed");
    expect(p).toContain("Missing null check (a.ts): can crash");
    expect(p).toContain("too broad");
  });

  test("asks for one fenced json block of lessons", () => {
    const p = debriefPrompt(evidence, []);
    expect(p).toContain("```json");
    expect(p).toContain('"lessons"');
    expect(p).toContain("0 to 2 lessons");
  });

  test("clips long output tails", () => {
    const p = debriefPrompt(
      { ...evidence, nogo: [{ checks: ["t"], tails: ["z".repeat(9000)] }] },
      [],
    );
    expect(p).toContain("z".repeat(1536));
    expect(p).not.toContain("z".repeat(1537));
  });
});

describe("parseDebrief", () => {
  test("reads a fenced block", () => {
    expect(parseDebrief(fenced({ lessons: ["Run vp check.", "Mock git."] }), [])).toEqual({
      lessons: ["Run vp check.", "Mock git."],
    });
  });

  test("keeps at most two", () => {
    expect(parseDebrief(fenced({ lessons: ["a", "b", "c"] }), [])).toEqual({ lessons: ["a", "b"] });
  });

  test("cuts a long lesson to 140", () => {
    const out = parseDebrief(fenced({ lessons: ["y".repeat(300)] }), []);
    expect("lessons" in out && Array.from(out.lessons[0]!)).toHaveLength(140);
  });

  test("drops empty strings and non-strings", () => {
    expect(parseDebrief(fenced({ lessons: ["  ", 4, "ok"] }), [])).toEqual({ lessons: ["ok"] });
  });

  test("drops repeats of kept lessons, ignoring case and spacing", () => {
    const out = parseDebrief(fenced({ lessons: ["RUN  vp   check.", "New one."] }), [
      "run vp check.",
    ]);
    expect(out).toEqual({ lessons: ["New one."] });
  });

  test("garbage is no lessons", () => {
    expect(parseDebrief("not json", [])).toEqual({ lessons: [] });
    expect(parseDebrief(envelope("no block here"), [])).toEqual({ lessons: [] });
    expect(parseDebrief(fenced({ other: 1 }), [])).toEqual({ lessons: [] });
  });

  test("an error envelope is a failure", () => {
    expect(
      parseDebrief(JSON.stringify({ is_error: true, result: "Credit balance too low" }), []),
    ).toEqual({ failed: "Credit balance too low" });
  });
});
