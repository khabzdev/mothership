import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DB_FILE, openHome } from "../home.server.ts";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface CreateDbOptions {
  /** Folder of drizzle-kit migrations. Defaults to `drizzle/` in the working directory (apps/station). */
  migrationsFolder?: string;
}

/** Open (or create) a database, enable foreign keys and apply pending migrations. */
export function createDb(path: string, options: CreateDbOptions = {}): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path);
  client.pragma("foreign_keys = ON");
  if (path !== ":memory:") client.pragma("journal_mode = WAL");
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: options.migrationsFolder ?? resolve("drizzle") });
  return db;
}

let instance: Db | undefined;

/** The station's database, opened on first use. */
export function getDb(): Db {
  instance ??= createDb(join(openHome(), DB_FILE));
  return instance;
}
