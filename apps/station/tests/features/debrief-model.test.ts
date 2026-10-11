import { describe, expect, test } from "vite-plus/test";
import {
  cleanLesson,
  LESSON_MAX,
  lessonsPrompt,
  parseDeckInput,
  parseLessonInput,
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
