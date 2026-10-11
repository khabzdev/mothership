import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The database file in the station's home. */
export const DB_FILE = "spaceship.db";

/** Where the station kept its data before it was renamed Spaceship. */
const LEGACY = { home: ".mothership", db: "mothership.db" };

/** SQLite's files for one database: itself and its WAL journal. */
const dbFiles = (name: string) => [name, `${name}-wal`, `${name}-shm`];

/**
 * Move a Mothership-era home to `home`, renaming its database (with its journal) to match. Only
 * when `home` doesn't exist yet, so nothing is ever overwritten. True when it moved.
 */
export function moveLegacyHome(legacy: string, home: string): boolean {
  if (!existsSync(legacy) || existsSync(home)) return false;
  renameSync(legacy, home);
  dbFiles(LEGACY.db).forEach((from, i) => {
    const path = join(home, from);
    if (existsSync(path)) renameSync(path, join(home, dbFiles(DB_FILE)[i]));
  });
  return true;
}

let resolved: string | undefined;

/**
 * Where Spaceship keeps its data: $SPACESHIP_HOME or ~/.spaceship. The first call moves an old
 * ~/.mothership over, so it runs before anything opens files in the home.
 */
export function spaceshipHome(): string {
  if (resolved) return resolved;
  if (process.env.SPACESHIP_HOME) return (resolved = process.env.SPACESHIP_HOME);
  resolved = join(homedir(), ".spaceship");
  moveLegacyHome(join(homedir(), LEGACY.home), resolved);
  return resolved;
}
