import type { ProviderAdapter } from "@mothership/providers";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { PtyCrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewRegistry } from "../../src/features/crew/registry.server.ts";

/** Stands in for claude: prints what it was launched with, then waits for input. */
const fakeProvider: ProviderAdapter = {
  id: "fake",
  launchPlan: (o) => ({
    command: "/bin/sh",
    args: [
      "-c",
      'printf "prompt=%s crew=%s hook=%s\\n" "$1" "$MOTHERSHIP_CREW_ID" "$MOTHERSHIP_HOOK_URL"; cat',
      "sh",
      o.prompt,
    ],
    cwd: o.cwd,
    env: {
      MOTHERSHIP_CREW_ID: o.crewId,
      MOTHERSHIP_HOOK_URL: o.hookUrl,
      MOTHERSHIP_HOOK_TOKEN: o.hookToken,
    },
  }),
  parseHook: () => null,
};

let home: string;
let launcher: PtyCrewLauncher;
let registry: CrewRegistry;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "mothership-launch-")));
  registry = new CrewRegistry();
  launcher = new PtyCrewLauncher({
    home,
    registry,
    providers: { fake: fakeProvider },
    stationUrl: "http://127.0.0.1:3999",
    ptyhostEntry: join(import.meta.dirname, "../../../../packages/ptyhost/src/bin.ts"),
  });
});

afterEach(async () => {
  await launcher.shutdownHost();
  rmSync(home, { recursive: true, force: true });
});

describe("PtyCrewLauncher", () => {
  test("launches the crew in the PTY host with hook env and a registered token", async () => {
    const exits: { crewId: string; exitCode: number }[] = [];
    launcher.onExit((e) => exits.push(e));
    await launcher.launch({
      crewId: "crew-1",
      missionId: "m1",
      provider: "fake",
      prompt: "Add dark mode",
      cwd: home,
    });

    const output = await launcher.waitForOutput("crew-1", /prompt=[^\r\n]*\r?\n/);
    expect(output).toContain(
      "prompt=Add dark mode crew=crew-1 hook=http://127.0.0.1:3999/api/hooks",
    );

    await launcher.write("crew-1", "still alive\r");
    expect(await launcher.waitForOutput("crew-1", /still alive/)).toContain("still alive");

    await launcher.stop("crew-1");
    await expect.poll(() => exits).toEqual([{ crewId: "crew-1", exitCode: expect.any(Number) }]);
    expect(registry.verify("crew-1", "anything")).toBeNull();
  });

  test("relaunching the same crew replaces the old session", async () => {
    await launcher.launch({
      crewId: "crew-1",
      missionId: "m1",
      provider: "fake",
      prompt: "one",
      cwd: home,
    });
    await launcher.launch({
      crewId: "crew-1",
      missionId: "m1",
      provider: "fake",
      prompt: "two",
      cwd: home,
    });
    expect(await launcher.waitForOutput("crew-1", /prompt=two/)).toContain("prompt=two");
  });

  test("unknown providers are rejected", async () => {
    await expect(
      launcher.launch({ crewId: "c", missionId: "m", provider: "nope", prompt: "x", cwd: home }),
    ).rejects.toThrow("Unknown provider: nope");
  });
});
