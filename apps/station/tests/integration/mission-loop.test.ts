import type { ServerMsg } from "@mothership/protocol";
import { PROVIDERS } from "@mothership/providers";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { handleHookRequest } from "../../src/features/crew/hooks.server.ts";
import { PtyCrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewRegistry } from "../../src/features/crew/registry.server.ts";
import { createMissionRecord, loadMission } from "../../src/features/missions/repo.server.ts";
import { MissionRuntime } from "../../src/features/missions/runtime.server.ts";
import { createDb } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

/** Behaves like Claude Code from the station's point of view: hooks, edits, then waits. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const { writeFileSync, mkdirSync } = require("node:fs");
const args = process.argv.slice(2);
const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
const prompt = args[args.indexOf("--") + 1];
const post = (event, extra) =>
  execFileSync("/bin/sh", ["-c", settings.hooks[event][0].hooks[0].command], {
    input: JSON.stringify({ hook_event_name: event, session_id: "fake", cwd: process.cwd(), ...extra }),
  });
post("SessionStart", { source: "startup" });
post("UserPromptSubmit", { prompt });
mkdirSync("src", { recursive: true });
writeFileSync("src/feature.txt", prompt.split("\\n")[0]);
post("PreToolUse", { tool_name: "Edit", tool_input: { file_path: process.cwd() + "/src/feature.txt" } });
post("Stop", { stop_hook_active: false });
process.stdin.resume();
`;

let scratch: string;
let server: Server;
let launcher: PtyCrewLauncher;
const originalPath = process.env.PATH;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-loop-")));
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
  // The PTY host inherits this PATH, so "claude" resolves to the fake.
  process.env.PATH = `${bin}:${originalPath}`;
});

afterAll(async () => {
  process.env.PATH = originalPath;
  await launcher?.shutdownHost();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

test(
  "a mission launches its crew and reaches pre-flight from real hook traffic",
  { timeout: 30_000 },
  async () => {
    const repo = join(scratch, "shop");
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, "README.md"), "hi");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "init",
    ]);

    const db = createDb(":memory:", {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
    const missionId = createMissionRecord(db, {
      deckId: "deck-1",
      goal: "Add dark mode",
      criteria: [{ kind: "command", command: "test -f src/feature.txt" }],
    });

    const registry = new CrewRegistry();
    const broadcasts: ServerMsg[] = [];
    const preflights: string[] = [];
    let runtime!: MissionRuntime;

    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const response = await handleHookRequest(
        new Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        }),
        { registry, providers: PROVIDERS, publish: (event) => void runtime.handleSignal(event) },
      );
      res.writeHead(response.status).end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const home = join(scratch, "home");
    launcher = new PtyCrewLauncher({
      home,
      registry,
      providers: PROVIDERS,
      stationUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      ptyhostEntry: join(import.meta.dirname, "../../../../packages/ptyhost/src/bin.ts"),
    });
    runtime = new MissionRuntime({ db, launcher, broadcast: (m) => broadcasts.push(m), home });
    runtime.setEffect("runPreflight", async ({ missionId: id }) => void preflights.push(id));

    expect((await runtime.dispatch(missionId, { type: "launchCrew" })).ok).toBe(true);

    await expect
      .poll(() => loadMission(db, missionId).mission.state, { timeout: 15_000 })
      .toBe("preflight");
    expect(preflights).toEqual([missionId]);

    const { worktreePath } = loadMission(db, missionId);
    expect(readFileSync(join(worktreePath!, "src/feature.txt"), "utf8")).toBe(
      "Mission: Add dark mode",
    );
    expect(existsSync(join(repo, "src/feature.txt"))).toBe(false);

    expect(
      broadcasts
        .filter((m) => m.type === "mission.updated")
        .map((m) => (m as { mission: { state: string } }).mission.state),
    ).toEqual(["building", "preflight"]);
  },
);
