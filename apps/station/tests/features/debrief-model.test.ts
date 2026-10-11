import { describe, expect, test } from "vite-plus/test";
import {
  cleanLesson,
  debriefToast,
  LESSON_MAX,
  lessonsPrompt,
  parseDeckInput,
  parseLessonInput,
  promotionLine,
} from "../../src/features/debrief/model.ts";

describe("lessonsPrompt", () => {
  test("is empty with nothing kept", () => {
    expect(lessonsPrompt([])).toBe("");
  });

  test("lists the lessons under a header", () => {
    expect(lessonsPrompt(["a", "b"])).toBe(
      "Lessons from earlier missions on this repo (follow them):\n- a\n- b",
    );
  });
});

describe("lessonsPrompt cleaning", () => {
  test("cleans every lesson and drops those left empty", () => {
    expect(lessonsPrompt(["a\nb", " \x1b ", "c"])).toBe(
      "Lessons from earlier missions on this repo (follow them):\n- a b\n- c",
    );
    expect(lessonsPrompt(["\x1b", ""])).toBe("");
  });
});

describe("cleanLesson", () => {
  test("strips escapes, carriage returns and newlines", () => {
    expect(cleanLesson("Run\x1b[201~ the\r\ntests\nfirst")).toBe("Run [201~ the tests first");
  });

  test("strips C1 controls, including the single-character CSI", () => {
    expect(cleanLesson("a\x9b31mb\x85c")).toBe("a 31mb c");
  });

  test("collapses spaces and trims", () => {
    expect(cleanLesson("  a   b \t c ")).toBe("a b c");
  });

  test("cuts to 140 characters with an ellipsis", () => {
    const out = cleanLesson("x".repeat(200));
    expect(Array.from(out)).toHaveLength(LESSON_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  test("does not split an emoji", () => {
    const out = cleanLesson("😀".repeat(200));
    expect(Array.from(out)).toHaveLength(LESSON_MAX);
    expect(
      Array.from(out)
        .slice(0, -1)
        .every((c) => c === "😀"),
    ).toBe(true);
  });

  test("leaves a short lesson alone", () => {
    expect(cleanLesson("Run vp check.")).toBe("Run vp check.");
  });
});

describe("parseLessonInput", () => {
  test("reads the lesson id", () => {
    expect(parseLessonInput({ lessonId: " l1 " })).toEqual({ lessonId: "l1" });
  });

  test("requires one", () => {
    expect(() => parseLessonInput({})).toThrow("lessonId is required");
    expect(() => parseLessonInput(null)).toThrow("lessonId is required");
  });
});

test("reuses the preflight deck input", () => {
  expect(parseDeckInput({ deckId: "d1" })).toEqual({ deckId: "d1" });
});

describe("debriefToast", () => {
  const base = { type: "deck.debrief", deckId: "d1", name: "Nova" } as const;

  test("names the lessons drafted and who they came from", () => {
    expect(debriefToast({ ...base, drafted: 2 })).toEqual({
      text: "Debrief: 2 lessons from Nova to review",
      tone: "default",
    });
    expect(debriefToast({ ...base, drafted: 1 })?.text).toBe(
      "Debrief: 1 lesson from Nova to review",
    );
  });

  test("a debrief that couldn't run is a warning with the reason", () => {
    expect(debriefToast({ ...base, drafted: 0, failed: "timed out" })).toEqual({
      text: "Debrief couldn't run for Nova: timed out",
      tone: "warning",
    });
  });

  test("nothing worth keeping is no toast", () => {
    expect(debriefToast({ ...base, drafted: 0 })).toBeNull();
  });
});

describe("promotionLine", () => {
  const base = { type: "crew.promoted", deckId: "d1", crewId: "c1", name: "Nova" } as const;

  test("a new rank", () => {
    expect(promotionLine({ ...base, rank: "Ensign" })).toBe("Nova promoted to Ensign");
  });

  test("a patch, by its display name", () => {
    expect(promotionLine({ ...base, patch: "steady-hand" })).toBe("Nova earned Steady Hand");
  });

  test("an unknown patch reads as its id; a message with neither is nothing", () => {
    expect(promotionLine({ ...base, patch: "moonwalker" })).toBe("Nova earned moonwalker");
    expect(promotionLine(base)).toBeNull();
  });
});
