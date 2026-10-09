import { PtyHostClient, ensurePtyHost, readHostState } from "@mothership/ptyhost";
import type { ProviderAdapter } from "@mothership/providers";
import { createRequire } from "node:module";
import type { CrewRegistry } from "./registry.server";

export interface LaunchRequest {
  crewId: string;
  missionId: string;
  provider: string;
  prompt: string;
  cwd: string;
}

/** Starts crew processes and types into them. */
export interface CrewLauncher {
  launch(request: LaunchRequest): Promise<void>;
  write(crewId: string, data: string): Promise<void>;
}

export interface PtyCrewLauncherOptions {
  home: string;
  registry: CrewRegistry;
  providers: Record<string, ProviderAdapter>;
  /** Base URL the crew's hooks post to, e.g. http://127.0.0.1:3000. */
  stationUrl: string;
  /** PTY host entry script; defaults to the built @mothership/ptyhost bin. */
  ptyhostEntry?: string;
}

const COLS = 120;
const ROWS = 32;
const OUTPUT_TAIL = 64 * 1024;

type ExitListener = (event: { crewId: string; exitCode: number }) => void;

/** Runs crew in the standalone PTY host so they survive station restarts. */
export class PtyCrewLauncher implements CrewLauncher {
  readonly #options: PtyCrewLauncherOptions;
  readonly #tails = new Map<string, string>();
  readonly #exitListeners = new Set<ExitListener>();
  /** Crew whose old session is being replaced: swallow that session's exit. */
  readonly #replacing = new Set<string>();
  #client: Promise<PtyHostClient> | null = null;

  constructor(options: PtyCrewLauncherOptions) {
    this.#options = options;
  }

  async launch(request: LaunchRequest): Promise<void> {
    const adapter = this.#options.providers[request.provider];
    if (!adapter) throw new Error(`Unknown provider: ${request.provider}`);
    const client = await this.#connect();

    const existing = (await client.list()).find((s) => s.id === request.crewId);
    if (existing) {
      if (!existing.exited) this.#replacing.add(request.crewId);
      await client.dispose(request.crewId);
    }
    this.#tails.delete(request.crewId);

    const { token } = this.#options.registry.register(request.crewId, {
      missionId: request.missionId,
      provider: request.provider,
    });
    const plan = adapter.launchPlan({
      crewId: request.crewId,
      prompt: request.prompt,
      cwd: request.cwd,
      hookUrl: `${this.#options.stationUrl}/api/hooks`,
      hookToken: token,
    });
    try {
      await client.spawn({
        id: request.crewId,
        command: plan.command,
        args: plan.args,
        cwd: plan.cwd,
        env: plan.env,
        cols: COLS,
        rows: ROWS,
      });
    } catch (error) {
      this.#options.registry.unregister(request.crewId);
      throw error;
    }
  }

  async write(crewId: string, data: string): Promise<void> {
    await (await this.#connect()).write(crewId, data);
  }

  async stop(crewId: string): Promise<void> {
    this.#options.registry.unregister(crewId);
    await (await this.#connect()).kill(crewId);
  }

  async sessions(): Promise<{ id: string; exited: boolean; exitCode?: number }[]> {
    return (await this.#connect()).list();
  }

  onExit(listener: ExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** Resolve with the crew's recent output once it matches `pattern`. */
  waitForOutput(crewId: string, pattern: RegExp, timeoutMs = 5000): Promise<string> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const tail = this.#tails.get(crewId) ?? "";
        if (pattern.test(tail)) return resolve(tail);
        if (Date.now() - started > timeoutMs) {
          return reject(new Error(`Timed out waiting for ${pattern} from ${crewId}`));
        }
        setTimeout(check, 25);
      };
      check();
    });
  }

  /** Stop the PTY host (tests and shutdown only: it kills every crew member). */
  async shutdownHost(): Promise<void> {
    const client = await this.#client?.catch(() => null);
    client?.close();
    this.#client = null;
    const state = readHostState(this.#options.home);
    if (state) process.kill(state.pid, "SIGTERM");
  }

  #connect(): Promise<PtyHostClient> {
    this.#client ??= (async () => {
      const entry =
        this.#options.ptyhostEntry ??
        createRequire(import.meta.url).resolve("@mothership/ptyhost/bin");
      const state = await ensurePtyHost({ home: this.#options.home, entry });
      const client = await PtyHostClient.connect(state);
      client.onOutput(({ id, data }) => {
        this.#tails.set(id, ((this.#tails.get(id) ?? "") + data).slice(-OUTPUT_TAIL));
      });
      client.onExit(({ id, exitCode }) => {
        if (this.#replacing.delete(id)) return;
        for (const listener of this.#exitListeners) listener({ crewId: id, exitCode });
      });
      await client.attachAll();
      return client;
    })().catch((error: unknown) => {
      this.#client = null;
      throw error;
    });
    return this.#client;
  }
}
