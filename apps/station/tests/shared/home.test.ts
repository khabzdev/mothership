import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { moveLegacyHome } from "../../src/shared/home.server.ts";

let root: string;
let legacy: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spaceship-home-"));
  legacy = join(root, ".mothership");
  home = join(root, ".spaceship");
});

const read = (path: string) => readFileSync(path, "utf8");

describe("moveLegacyHome", () => {
  test("moves the old folder over, renaming the database with its journal", () => {
    mkdirSync(join(legacy, "preflight"), { recursive: true });
    writeFileSync(join(legacy, "mothership.db"), "db");
    writeFileSync(join(legacy, "mothership.db-wal"), "wal");
    writeFileSync(join(legacy, "mothership.db-shm"), "shm");
    writeFileSync(join(legacy, "crew.json"), "{}");

    expect(moveLegacyHome(legacy, home)).toBe(true);

    expect(existsSync(legacy)).toBe(false);
    expect(read(join(home, "spaceship.db"))).toBe("db");
    expect(read(join(home, "spaceship.db-wal"))).toBe("wal");
    expect(read(join(home, "spaceship.db-shm"))).toBe("shm");
    expect(existsSync(join(home, "mothership.db"))).toBe(false);
    expect(read(join(home, "crew.json"))).toBe("{}");
    expect(existsSync(join(home, "preflight"))).toBe(true);
  });

  test("a database without a journal still moves", () => {
    mkdirSync(legacy);
    writeFileSync(join(legacy, "mothership.db"), "db");

    expect(moveLegacyHome(legacy, home)).toBe(true);
    expect(read(join(home, "spaceship.db"))).toBe("db");
    expect(existsSync(join(home, "spaceship.db-wal"))).toBe(false);
  });

  test("leaves both alone when the new folder already exists", () => {
    mkdirSync(legacy);
    writeFileSync(join(legacy, "mothership.db"), "old");
    mkdirSync(home);
    writeFileSync(join(home, "spaceship.db"), "new");

    expect(moveLegacyHome(legacy, home)).toBe(false);
    expect(read(join(legacy, "mothership.db"))).toBe("old");
    expect(read(join(home, "spaceship.db"))).toBe("new");
  });

  test("does nothing on a fresh machine", () => {
    expect(moveLegacyHome(legacy, home)).toBe(false);
    expect(existsSync(home)).toBe(false);
  });
});

describe("spaceshipHome and openHome", () => {
  test("working out the home never moves files; opening it does, once", async () => {
    const saved = { HOME: process.env.HOME, SPACESHIP_HOME: process.env.SPACESHIP_HOME };
    process.env.HOME = root;
    delete process.env.SPACESHIP_HOME;
    try {
      vi.resetModules();
      const { spaceshipHome, openHome } = await import("../../src/shared/home.server.ts");
      mkdirSync(legacy);
      writeFileSync(join(legacy, "mothership.db"), "db");

      expect(spaceshipHome()).toBe(home);
      expect(existsSync(legacy)).toBe(true);

      expect(openHome()).toBe(home);
      expect(read(join(home, "spaceship.db"))).toBe("db");
      expect(existsSync(legacy)).toBe(false);
    } finally {
      Object.assign(process.env, saved);
      if (saved.SPACESHIP_HOME === undefined) delete process.env.SPACESHIP_HOME;
    }
  });

  test("tests run with their own home, never the real one", async () => {
    const { spaceshipHome } = await import("../../src/shared/home.server.ts");
    expect(process.env.SPACESHIP_HOME).toBeTruthy();
    expect(spaceshipHome()).not.toBe(join(homedir(), ".spaceship"));
  });
});
