import { claudeCode, type CrewSignal, type ProviderAdapter } from "@mothership/providers";
import { readHostState } from "@mothership/ptyhost";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEF_INSTRUCTIONS } from "../src/features/briefs/model";
import { screenLines } from "../src/features/briefs/dialog";
import { handleHookRequest, type CrewSignalEvent } from "../src/features/crew/hooks.server";
import { PtyCrewLauncher } from "../src/features/crew/launcher.server";
import { SUBMIT_DELAY_MS, bracketedPaste } from "../src/features/crew/paste";
import { CrewRegistry, type CrewEntry } from "../src/features/crew/registry.server";

/** One hook post the receiver accepted (crew and token checked by the station's own handler). */
export interface Signal {
  /** The payload's hook_event_name, e.g. "Stop". */
  event: string;
  /** What the provider's parseHook made of it; null for events that don't change status. */
  signal: CrewSignal | null;
  /** The provider's sessionOf: set only for a valid session id. */
  sessionId?: string;
  payload: unknown;
  at: number;
}

export interface Harness {
  /** The throwaway git repo every crew member runs in. */
  repo: string;
  launch(opts: {
    crewId: string;
    task?: string;
    plan?: boolean;
    instructions?: string;
  }): Promise<void>;
  signals(crewId: string): Signal[];
  /** The first signal (earlier ones included) matching `pred`; rejects after `ms`. */
  waitFor(
    crewId: string,
    pred: (signal: Signal, index: number) => boolean,
    ms: number,
  ): Promise<Signal>;
  /** The crew's screen, one text per row (as the station's dialog reader sees it). */
  screen(crewId: string): Promise<string[]>;
  write(crewId: string, data: string): Promise<void>;
  /** Paste and submit, exactly as the station prompts a crew member. */
  paste(crewId: string, text: string): Promise<void>;
  stop(crewId: string): Promise<void>;
  /** Hook tokens handed out: never written to results. */
  secrets(): string[];
  /** Stop every session, the PTY host and the receiver; delete the temp repo and launcher home. */
  close(): Promise<void>;
  /** close() for an interrupted run: synchronous, best effort. */
  abort(): void;
}

const CLAUDE = "claude-code";
/** How long launch() watches for Claude's folder-trust prompt before its first hook. */
const TRUST_WINDOW_MS = 15_000;
const TRUST_PROMPT = /trust (the files in )?this folder/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The station's registry class, but the harness's own instance, remembering tokens to redact. */
class SmokeRegistry extends CrewRegistry {
  readonly tokens = new Set<string>();

  override register(crewId: string, entry: CrewEntry): { token: string } {
    const result = super.register(crewId, entry);
    this.tokens.add(result.token);
    return result;
  }
}

/** A throwaway repo: one commit with a package.json and a README. */
function createRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "mothership-smoke-")));
  writeFileSync(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "smoke", scripts: { test: "node -e 0" } }, null, 2)}\n`,
  );
  writeFileSync(join(repo, "README.md"), "# smoke\n\nA throwaway repo for the Mothership smoke.\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "package.json", "README.md");
  git(
    "-c",
    "user.name=Mothership smoke",
    "-c",
    "user.email=smoke@mothership.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "smoke",
  );
  return repo;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Stands in for the station's /api/hooks, through the station's own handler. */
async function startReceiver(
  registry: CrewRegistry,
  record: (crewId: string, signal: Signal) => void,
): Promise<{ server: Server; url: string }> {
  const providers = { [CLAUDE]: claudeCode };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || req.url !== "/api/hooks") return res.writeHead(404).end();
      const body = await readBody(req);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      let published: CrewSignalEvent | undefined;
      const response = await handleHookRequest(
        new Request(`http://127.0.0.1${req.url}`, { method: "POST", headers, body }),
        { registry, providers, publish: (event) => (published = event) },
      );
      if (response.status === 204) {
        // Accepted, so the body is JSON and the crew header was verified.
        const payload: unknown = JSON.parse(body);
        const event = (payload as { hook_event_name?: unknown }).hook_event_name;
        const sessionId = claudeCode.sessionOf?.(payload);
        record(headers.get("x-mothership-crew") ?? "", {
          event: typeof event === "string" ? event : "unknown",
          signal: published?.signal ?? null,
          ...(sessionId && { sessionId }),
          payload,
          at: Date.now(),
        });
      }
      res.writeHead(response.status).end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/**
 * The station's real launch path against the installed claude: its PTY host, PtyCrewLauncher,
 * claude-code provider and hook handler. Everything lives in temp folders of its own; the station's
 * home, registry and PTY host are never touched.
 */
export async function startHarness({ model }: { model: string }): Promise<Harness> {
  const repo = createRepo();
  const home = realpathSync(mkdtempSync(join(tmpdir(), "mothership-smoke-home-")));
  const registry = new SmokeRegistry(join(home, "crew.json"));
  const signals = new Map<string, Signal[]>();
  const waiters = new Set<() => void>();
  const { server, url } = await startReceiver(registry, (crewId, signal) => {
    signals.set(crewId, [...(signals.get(crewId) ?? []), signal]);
    for (const wake of waiters) wake();
  });
  // The real provider, with the smoke's model as its launch option.
  const provider: ProviderAdapter = {
    ...claudeCode,
    launchPlan: (options) => claudeCode.launchPlan({ ...options, model }),
  };
  const launcher = new PtyCrewLauncher({
    home,
    registry,
    providers: { [CLAUDE]: provider },
    stationUrl: url,
  });
  const launched = new Set<string>();
  const signalsOf = (crewId: string) => signals.get(crewId) ?? [];
  const screen = async (crewId: string) => screenLines(await launcher.screen(crewId));

  /** A fresh repo makes claude ask whether to trust it; say yes so the session can start. */
  async function acceptTrust(crewId: string) {
    const deadline = Date.now() + TRUST_WINDOW_MS;
    while (Date.now() < deadline && signalsOf(crewId).length === 0) {
      if (TRUST_PROMPT.test((await screen(crewId)).join("\n"))) {
        console.log(`smoke: accepted Claude Code's folder-trust prompt for ${repo}`);
        await launcher.write(crewId, "\r");
        return;
      }
      await sleep(250);
    }
  }

  function removeTemp() {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }

  return {
    repo,
    async launch({ crewId, task, plan, instructions }) {
      signals.delete(crewId);
      launched.add(crewId);
      await launcher.launch({
        crewId,
        missionId: "smoke",
        provider: CLAUDE,
        prompt: task ?? "",
        cwd: repo,
        ...(plan && { plan: { instructions: BRIEF_INSTRUCTIONS } }),
        ...(instructions && { instructions }),
      });
      await acceptTrust(crewId);
    },
    signals: signalsOf,
    waitFor(crewId, pred, ms) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = signalsOf(crewId).find(pred);
          if (!found) return;
          done();
          resolve(found);
        };
        const timer = setTimeout(() => {
          done();
          reject(new Error(`no matching hook within ${Math.round(ms / 1000)} s`));
        }, ms);
        const done = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    },
    screen,
    write: (crewId, data) => launcher.write(crewId, data),
    async paste(crewId, text) {
      await launcher.write(crewId, bracketedPaste(text));
      await sleep(SUBMIT_DELAY_MS);
      await launcher.write(crewId, "\r");
    },
    async stop(crewId) {
      launched.delete(crewId);
      await launcher.stop(crewId);
    },
    secrets: () => [...registry.tokens],
    async close() {
      try {
        for (const crewId of launched) await launcher.stop(crewId).catch(() => {});
        launched.clear();
        await launcher.shutdownHost().catch(() => {});
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      } finally {
        removeTemp();
      }
    },
    abort() {
      try {
        const host = readHostState(home);
        // The PTY host takes every crew session down with it.
        if (host) process.kill(host.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
      server.closeAllConnections();
      server.close();
      removeTemp();
    },
  };
}
