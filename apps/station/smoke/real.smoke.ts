// The real-claude smoke: `vp run smoke:real` in apps/station. Never part of plain `vp test`.
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mothershipHome } from "../src/shared/db/client.server";
import { claudeBasics } from "./claude-basics";
import { claudeFlows } from "./claude-flows";
import type { SmokeContext, SmokeGroup } from "./group";
import { BUILD_PTYHOST, ptyhostBuilt, requireSmokeEnv, smokeModel } from "./guard";
import { SmokeRun, table } from "./results";

requireSmokeEnv();

/** Every check group, run in this order: one line each. */
const GROUPS: SmokeGroup[] = [claudeBasics, claudeFlows];

const model = smokeModel();
const ctx: SmokeContext = {
  run: new SmokeRun({ home: mothershipHome(), model, secrets: () => ctx.harness?.secrets() ?? [] }),
  model,
  harness: null,
  harnessError: "",
  versions: { claude: null, gh: null },
  claudeReady: false,
};

let finished = false;
/** Write smoke.json once: checks never reached are failed "did not finish". */
function finish() {
  if (finished) return;
  finished = true;
  const file = ctx.run.finish(
    ctx.versions,
    GROUPS.flatMap((group) => group.ids),
  );
  console.log(`\n${table(file)}\n\nWrote ${mothershipHome()}/smoke.json\n`);
}

/** Interrupted: still record what ran, and leave nothing behind. */
function interrupted(code: number) {
  try {
    finish();
  } finally {
    ctx.harness?.abort();
    process.exit(code);
  }
}
process.once("SIGINT", () => interrupted(130));
process.once("SIGTERM", () => interrupted(143));
// The test runner went away (its worker channel closed): after a finished run that is just the end.
process.once("disconnect", () => interrupted(finished ? 0 : 1));

beforeAll(async () => {
  if (!ptyhostBuilt()) {
    ctx.harnessError = BUILD_PTYHOST;
    return;
  }
  try {
    // Loaded here so an unbuilt workspace package fails the checks, not the whole file.
    const { startHarness } = await import("./harness");
    ctx.harness = await startHarness({ model });
  } catch (error) {
    ctx.harnessError = `harness did not start: ${(error as Error).message}`;
  }
});

afterAll(async () => {
  try {
    await ctx.harness?.close();
  } finally {
    finish();
  }
});

for (const group of GROUPS) {
  test(group.ids.join(", "), async () => {
    await group.run(ctx);
    const failed = ctx.run.checks().filter((c) => group.ids.includes(c.id) && c.state === "failed");
    expect(failed).toEqual([]);
  });
}
