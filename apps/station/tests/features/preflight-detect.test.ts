import { describe, expect, test } from "vite-plus/test";
import { detectChecks } from "../../src/features/preflight/detect.ts";

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

describe("detectChecks", () => {
  test("vite-plus project → check then test", () => {
    expect(detectChecks({ "package.json": '{"devDependencies":{"vite-plus":"1"}}' })).toEqual([
      { name: "check", command: "vp check" },
      { name: "test", command: "vp test" },
    ]);
  });

  test("package scripts use the lockfile's manager, fast ones first", () => {
    const scripts = pkg({ build: "x", test: "x", lint: "x", typecheck: "x" });
    const names = ["typecheck", "lint", "test", "build"];
    const cases: [Record<string, string>, (n: string) => string][] = [
      [{ "pnpm-lock.yaml": "" }, (n) => `pnpm run ${n}`],
      [{ "package-lock.json": "{}" }, (n) => `npm run ${n}`],
      [{ "yarn.lock": "" }, (n) => `yarn ${n}`],
      [{ "bun.lock": "" }, (n) => `bun run ${n}`],
      [{ "bun.lockb": "" }, (n) => `bun run ${n}`],
      [{}, (n) => `npm run ${n}`],
    ];
    for (const [lock, cmd] of cases) {
      const found = detectChecks({ "package.json": scripts, ...lock });
      expect(found.map((c) => c.name)).toEqual(names);
      expect(found.map((c) => c.command)).toEqual(names.map(cmd));
    }
  });

  test("vite-plus wins over scripts named check/test", () => {
    const found = detectChecks({
      "package.json": JSON.stringify({
        devDependencies: { "vite-plus": "1" },
        scripts: { check: "x", test: "x", lint: "x" },
      }),
      "pnpm-lock.yaml": "",
    });
    expect(found).toEqual([
      { name: "lint", command: "pnpm run lint" },
      { name: "check", command: "vp check" },
      { name: "test", command: "vp test" },
    ]);
  });

  test("Cargo.toml → cargo check, cargo test", () => {
    expect(detectChecks({ "Cargo.toml": "[package]" })).toEqual([
      { name: "check", command: "cargo check" },
      { name: "test", command: "cargo test" },
    ]);
  });

  test("go.mod → go vet ./..., go test ./...", () => {
    expect(detectChecks({ "go.mod": "module x" })).toEqual([
      { name: "vet", command: "go vet ./..." },
      { name: "test", command: "go test ./..." },
    ]);
  });

  test("pyproject with [tool.pytest] and [tool.ruff] → ruff check, pytest", () => {
    expect(detectChecks({ "pyproject.toml": "[tool.ruff]\n[tool.pytest.ini_options]\n" })).toEqual([
      { name: "lint", command: "ruff check" },
      { name: "test", command: "pytest" },
    ]);
  });

  test("Makefile targets test: and lint: → make lint, make test", () => {
    expect(detectChecks({ Makefile: "lint:\n\techo\ntest:\n\techo\n" })).toEqual([
      { name: "lint", command: "make lint" },
      { name: "test", command: "make test" },
    ]);
  });

  test("nothing recognised → []", () => {
    expect(detectChecks({})).toEqual([]);
    expect(detectChecks({ "package.json": "not json" })).toEqual([]);
  });
});
