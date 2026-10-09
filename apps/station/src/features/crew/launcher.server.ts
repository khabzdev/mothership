import {
  PtyHostClient,
  ensurePtyHost,
  readHostState,
  type AttachResult,
  type HostState,
} from "@mothership/ptyhost";
import type { ScreenFrame } from "@mothership/protocol";
import type { ProviderAdapter } from "@mothership/providers";
import { createRequire } from "node:module";
import type { CrewRegistry } from "./registry.server";
import type { ScreenSource } from "./screens.server";
import type { TerminalSource } from "./terminals.server";

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
  /** Kill the crew member's process and forget its session. */
  stop(crewId: string): Promise<void>;
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
type OutputListener = (event: { crewId: string; data: string; seq: number }) => void;

/** Runs crew in the standalone PTY host so they survive station restarts. */
export class PtyCrewLauncher implements CrewLauncher, TerminalSource, ScreenSource {
  readonly #options: PtyCrewLauncherOptions;
  readonly #tails = new Map<string, string>();
  readonly #exitListeners = new Set<ExitListener>();
  readonly #outputListeners = new Set<OutputListener>();
  /** Crew whose old session is being replaced: swallow that session's exit. */
  readonly #replacing = new Set<string>();
  readonly #hostLostListeners = new Set<() => void>();
  #client: Promise<PtyHostClient> | null = null;
  #hostState: HostState | null = null;

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

  async snapshot(crewId: string): Promise<AttachResult> {
    return (await this.#connect()).snapshot(crewId);
  }

  async screen(crewId: string): Promise<ScreenFrame> {
    return (await this.#connect()).screen(crewId);
  }

  async resize(crewId: string, cols: number, rows: number): Promise<void> {
    await (await this.#connect()).resize(crewId, cols, rows);
  }

  onOutput(listener: OutputListener): () => void {
    this.#outputListeners.add(listener);
    return () => this.#outputListeners.delete(listener);
  }

  async stop(crewId: string): Promise<void> {
    this.#options.registry.unregister(crewId);
    this.#tails.delete(crewId);
    const client = await this.#connect();
    const session = (await client.list()).find((s) => s.id === crewId);
    if (!session) return;
    // Sent home on purpose: its exit is not news.
    if (!session.exited) this.#replacing.add(crewId);
    await client.dispose(crewId);
  }

  async sessions(): Promise<{ id: string; exited: boolean; exitCode?: number }[]> {
    return (await this.#connect()).list();
  }

  onExit(listener: ExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** The PTY host the launcher is connected to (connecting if needed). */
  async host(): Promise<HostState> {
    await this.#connect();
    return this.#hostState!;
  }

  /** Called when the connection to the PTY host drops; the next call reconnects. */
  onHostLost(listener: () => void): () => void {
    this.#hostLostListeners.add(listener);
    return () => this.#hostLostListeners.delete(listener);
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
      this.#hostState = state;
      client.onClose(() => {
        this.#client = null;
        for (const listener of this.#hostLostListeners) listener();
      });
      client.onOutput(({ id, data, seq }) => {
        this.#tails.set(id, ((this.#tails.get(id) ?? "") + data).slice(-OUTPUT_TAIL));
        for (const listener of this.#outputListeners) listener({ crewId: id, data, seq });
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
