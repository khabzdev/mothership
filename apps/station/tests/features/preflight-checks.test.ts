import type { ServerMsg } from "@mothership/protocol";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { CheckService } from "../../src/features/preflight/checks.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

let scratch: string;
let repo: string;
let db: Db;
let sent: ServerMsg[];
let service: CheckService;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-checks-")));
  repo = scratch;
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  writeFileSync(join(repo, "package.json"), '{"devDependencies":{"vite-plus":"1"}}');
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  sent = [];
  service = new CheckService({ db, broadcast: (m) => sent.push(m) });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("CheckService", () => {
  test("ensureDetected fills an unarmed deck once", async () => {
    const first = await service.ensureDetected("deck-1");
    expect(first.map((c) => c.command)).toEqual(["vp check", "vp test"]);
    expect(first.every((c) => c.enabled && c.timeoutMs === 300_000)).toBe(true);
    const before = sent.length;
    const second = await service.ensureDetected("deck-1");
    expect(second).toEqual(first);
    expect(sent.length).toBe(before);
    expect(service.armed("deck-1")).toBeNull();
  });

  test("arm(true) is remembered and broadcast", async () => {
    await service.ensureDetected("deck-1");
    service.arm("deck-1", true);
    expect(service.armed("deck-1")).toBe(true);
    expect(sent.at(-1)).toEqual({
      type: "deck.checks",
      deckId: "deck-1",
      armed: true,
      checks: service.list("deck-1"),
      inspector: true,
    });
  });

  test("update toggles a check and edits its command", async () => {
    const [check] = await service.ensureDetected("deck-1");
    const updated = service.update({
      deckId: "deck-1",
      checkId: check!.id,
      command: "vp check --fix",
      enabled: false,
      timeoutMs: 60_000,
    });
    expect(updated).toMatchObject({ command: "vp check --fix", enabled: false, timeoutMs: 60_000 });
    expect(service.enabled("deck-1").map((c) => c.name)).toEqual(["test"]);
    expect(sent.at(-1)).toEqual(service.message("deck-1"));
    expect(() => service.update({ deckId: "deck-1", checkId: "nope", enabled: true })).toThrow();
  });

  test("detect again replaces the list but keeps arming", async () => {
    await service.ensureDetected("deck-1");
    service.arm("deck-1", true);
    writeFileSync(join(repo, "go.mod"), "module x");
    writeFileSync(join(repo, "package.json"), "{}");
    const again = await service.detect("deck-1");
    expect(again.map((c) => c.command)).toEqual(["go vet ./...", "go test ./..."]);
    expect(service.list("deck-1")).toEqual(again);
    expect(service.armed("deck-1")).toBe(true);
  });
});
