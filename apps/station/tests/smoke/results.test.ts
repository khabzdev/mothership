import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { parseSmokeFile } from "../../src/app/smoke.ts";
import { SmokeRun, redact, runCheck, table } from "../../smoke/results.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spaceship-smoke-results-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const NOW = 1_700_000_000_000;

describe("SmokeRun.finish", () => {
  test("marks expected checks without a result failed and writes a file the station reads", () => {
    const run = new SmokeRun({ home, model: "haiku", now: () => NOW });
    run.record({
      id: "claude.version",
      state: "passed",
      detail: "2.1.104 · signed in via claude.ai",
    });

    const file = run.finish({ claude: "2.1.104", gh: null }, [
      "claude.version",
      "claude.hooks",
      "claude.paste-submit",
    ]);

    expect(file.checks).toEqual([
      { id: "claude.version", state: "passed", detail: "2.1.104 · signed in via claude.ai" },
      { id: "claude.hooks", state: "failed", detail: "did not finish" },
      { id: "claude.paste-submit", state: "failed", detail: "did not finish" },
    ]);
    const parsed = parseSmokeFile(readFileSync(join(home, "smoke.json"), "utf8"));
    expect(parsed).toEqual({
      ranAt: NOW,
      claudeVersion: "2.1.104",
      ghVersion: null,
      model: "haiku",
      checks: file.checks,
    });
  });

  test("keeps details to one line of at most 200 characters", () => {
    const run = new SmokeRun({ home, model: "haiku", now: () => NOW });
    run.record({ id: "a", state: "failed", detail: `first\nsecond ${"x".repeat(300)}` });
    const [check] = run.finish({ claude: null, gh: null }, ["a"]).checks;
    expect(check!.detail).not.toContain("\n");
    expect(check!.detail.startsWith("first second")).toBe(true);
    expect(check!.detail.length).toBeLessThanOrEqual(200);
  });

  test("redacts secrets from details", () => {
    const run = new SmokeRun({ home, model: "haiku", secrets: () => ["tok123"] });
    run.record({ id: "a", state: "failed", detail: "bad token tok123" });
    expect(run.finish({ claude: null, gh: null }, ["a"]).checks[0]!.detail).toBe(
      "bad token [redacted]",
    );
  });
});

describe("emails", () => {
  test("are redacted from details", () => {
    const run = new SmokeRun({ home, model: "haiku" });
    run.record({ id: "a", state: "failed", detail: "signed in as ada.l@example.co.uk" });
    expect(run.finish({ claude: null, gh: null }, ["a"]).checks[0]!.detail).toBe(
      "signed in as [redacted]",
    );
  });

  test("are redacted from evidence", () => {
    const run = new SmokeRun({ home, model: "haiku" });
    run.evidence("claude.hooks", "screen.txt", " ada@example.com's Organization \n");
    const text = readFileSync(join(home, "smoke", "claude.hooks", "screen.txt"), "utf8");
    expect(text).toBe(" [redacted] Organization \n");
  });
});

describe("SmokeRun.evidence", () => {
  test("writes the evidence under smoke/<id>/ with secrets redacted", () => {
    const run = new SmokeRun({ home, model: "haiku", secrets: () => ["s3cret-token"] });
    run.evidence("claude.hooks", "hooks.jsonl", '{"token":"s3cret-token"}\n');
    const text = readFileSync(join(home, "smoke", "claude.hooks", "hooks.jsonl"), "utf8");
    expect(text).toBe('{"token":"[redacted]"}\n');
  });

  test("replaces the previous run's evidence", () => {
    mkdirSync(join(home, "smoke", "old.check"), { recursive: true });
    writeFileSync(join(home, "smoke", "old.check", "screen.txt"), "old");
    new SmokeRun({ home, model: "haiku" });
    expect(existsSync(join(home, "smoke", "old.check"))).toBe(false);
  });
});

describe("redact", () => {
  test("replaces every occurrence of each secret and ignores empty ones", () => {
    expect(redact("a1 b2 a1", ["a1", "b2", ""])).toBe("[redacted] [redacted] [redacted]");
  });
});

describe("table", () => {
  test("one line per check: id · state · detail", () => {
    const text = table({
      ranAt: NOW,
      claudeVersion: null,
      ghVersion: null,
      model: "haiku",
      checks: [
        { id: "claude.version", state: "passed", detail: "2.1.104" },
        { id: "claude.hooks", state: "skipped", detail: "claude unavailable" },
      ],
    });
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^claude\.version\s+· passed\s+· 2\.1\.104$/);
    expect(lines[1]).toMatch(/^claude\.hooks\s+· skipped · claude unavailable$/);
  });
});

describe("runCheck", () => {
  test("records the outcome", async () => {
    const run = new SmokeRun({ home, model: "haiku" });
    await runCheck(run, "a", async () => ({ state: "passed", detail: "ok" }));
    expect(run.checks()).toEqual([{ id: "a", state: "passed", detail: "ok" }]);
  });

  test("a throwing check is failed with its message", async () => {
    const run = new SmokeRun({ home, model: "haiku" });
    await runCheck(run, "a", async () => {
      throw new Error("boom");
    });
    expect(run.checks()).toEqual([{ id: "a", state: "failed", detail: "boom" }]);
  });

  test("a check past its timeout is failed", async () => {
    const run = new SmokeRun({ home, model: "haiku" });
    await runCheck(run, "a", () => new Promise(() => {}), 20);
    expect(run.checks()).toEqual([
      { id: "a", state: "failed", detail: expect.stringMatching(/^timed out after /) },
    ]);
  });
});
