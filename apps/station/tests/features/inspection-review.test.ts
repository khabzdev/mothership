import { describe, expect, test } from "vite-plus/test";
import {
  DIFF_CAP_BYTES,
  parseReview,
  reviewFailure,
  reviewPrompt,
} from "../../src/features/inspection/review.ts";

const input = { brief: null, task: "Fix login", checks: [], scope: [], diff: "diff" };
const envelope = (result: string) => JSON.stringify({ type: "result", result });
const UNREADABLE = [
  {
    severity: "note",
    source: "review",
    title: "Inspector's report was unreadable",
    why: expect.stringMatching(/\S/),
  },
];

describe("reviewPrompt", () => {
  test("labels the task when there is no brief", () => {
    const p = reviewPrompt(input);
    expect(p).toContain("Task (no approved brief)");
    expect(p).toContain("Fix login");
  });

  test("includes the approved brief, checks and scope findings", () => {
    const p = reviewPrompt({
      ...input,
      brief: "## Goal\nDo X",
      checks: [{ name: "lint", verdict: "pass" }],
      scope: [{ severity: "note", source: "scope", title: "Large change: 500 lines", why: "w" }],
    });
    expect(p).toContain("Approved brief");
    expect(p).toContain("Do X");
    expect(p).toContain("lint");
    expect(p).toContain("Large change: 500 lines");
  });

  test("clips a huge diff", () => {
    const p = reviewPrompt({ ...input, diff: "x".repeat(70_000) });
    expect(p).toContain("clipped");
    expect(p.length).toBeLessThan(70_000);
    expect(
      Buffer.byteLength(p.slice(p.indexOf("xxxx"), p.lastIndexOf("x") + 1)),
    ).toBeLessThanOrEqual(DIFF_CAP_BYTES);
  });

  test("asks for one fenced json block with findings", () => {
    const p = reviewPrompt(input);
    expect(p).toContain("```json");
    expect(p).toContain("findings");
  });
});

describe("parseReview", () => {
  const block = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";
  test("reads a fenced block from the envelope", () => {
    const f = { severity: "blocker", file: "a.ts", line: 3, title: "T", why: "W" };
    expect(parseReview(envelope(`Here you go\n${block({ findings: [f] })}`))).toEqual([
      { ...f, source: "review" },
    ]);
  });

  test("the last fenced block wins", () => {
    const a = { severity: "note", title: "first", why: "w" };
    const b = { severity: "note", title: "second", why: "w" };
    const out = parseReview(envelope(`${block({ findings: [a] })}\n${block({ findings: [b] })}`));
    expect(out.map((f) => f.title)).toEqual(["second"]);
  });

  test("bare JSON parses", () => {
    const out = parseReview(
      envelope(JSON.stringify({ findings: [{ severity: "note", title: "t", why: "w" }] })),
    );
    expect(out).toHaveLength(1);
  });

  test("unreadable output becomes one note", () => {
    expect(parseReview(envelope("no json here"))).toEqual(UNREADABLE);
    expect(parseReview("")).toEqual(UNREADABLE);
    expect(parseReview("garbage")).toEqual(UNREADABLE);
    expect(parseReview(JSON.stringify({ type: "result" }))).toEqual(UNREADABLE);
  });

  test("caps, drops invalid, and truncates titles", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      severity: "note",
      title: `t${i}`,
      why: "w",
    }));
    expect(parseReview(envelope(block({ findings: many })))).toHaveLength(10);
    const mixed = [
      { severity: "critical", title: "bad", why: "w" },
      { severity: "note", why: "no title" },
      { severity: "note", title: "y".repeat(120), why: "w" },
    ];
    const out = parseReview(envelope(block({ findings: mixed })));
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toHaveLength(80);
    expect(out[0]!.title.endsWith("…")).toBe(true);
  });
});

describe("reviewFailure", () => {
  test("a successful envelope is no failure", () => {
    expect(reviewFailure(envelope("ok"))).toBeNull();
    expect(
      reviewFailure(
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "x" }),
      ),
    ).toBeNull();
    expect(reviewFailure("garbage")).toBeNull();
  });

  test("an error envelope is a failure with its text", () => {
    expect(
      reviewFailure(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          result: "  Invalid API key \n",
        }),
      ),
    ).toBe("Invalid API key");
    expect(
      reviewFailure(
        JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: false }),
      ),
    ).toBe("error_max_turns");
  });

  test("long error text is clipped", () => {
    const out = reviewFailure(JSON.stringify({ is_error: true, result: "e".repeat(1000) }))!;
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });
});
