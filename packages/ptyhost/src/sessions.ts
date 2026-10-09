import pty from "@lydell/node-pty";
import { SerializeAddon } from "@xterm/addon-serialize";
import headless from "@xterm/headless";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { AttachResult, HostEvent, ScreenFrame, SessionInfo, SpawnSpec } from "./protocol.ts";
import { readScreen } from "./screen.ts";

const SCROLLBACK = 5000;

export type Subscriber = (event: HostEvent) => void;

interface Session {
  info: SessionInfo;
  pty: pty.IPty;
  mirror: headless.Terminal;
  serializer: SerializeAddon;
  seq: number;
}

/** Owns the PTYs and their headless mirrors. Knows nothing about sockets. */
export class SessionManager {
  readonly #sessions = new Map<string, Session>();
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  readonly #wildcard = new Set<Subscriber>();

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((s) => ({ ...s.info }));
  }

  spawn(spec: SpawnSpec): SessionInfo {
    if (this.#sessions.has(spec.id)) throw new Error(`Session already exists: ${spec.id}`);
    const command = resolveCommand(spec.command, spec.env?.PATH ?? process.env.PATH ?? "");
    const proc = pty.spawn(command, spec.args, {
      name: "xterm-256color",
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env } as Record<string, string>,
    });
    const mirror = new headless.Terminal({
      cols: spec.cols,
      rows: spec.rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    mirror.loadAddon(serializer);

    const session: Session = {
      info: {
        id: spec.id,
        pid: proc.pid,
        command: spec.command,
        cwd: spec.cwd,
        cols: spec.cols,
        rows: spec.rows,
        exited: false,
      },
      pty: proc,
      mirror,
      serializer,
      seq: 0,
    };
    this.#sessions.set(spec.id, session);

    proc.onData((data) => {
      session.seq++;
      mirror.write(data);
      this.#emit({ type: "output", id: spec.id, data, seq: session.seq });
    });
    proc.onExit(({ exitCode, signal }) => {
      Object.assign(session.info, { exited: true, exitCode, ...(signal ? { signal } : {}) });
      this.#emit({ type: "exit", id: spec.id, exitCode, ...(signal ? { signal } : {}) });
    });
    return { ...session.info };
  }

  write(id: string, data: string): void {
    const session = this.#get(id);
    if (!session.info.exited) session.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.#get(id);
    if (!session.info.exited) session.pty.resize(cols, rows);
    session.mirror.resize(cols, rows);
    Object.assign(session.info, { cols, rows });
  }

  kill(id: string, signal = "SIGTERM"): void {
    const session = this.#get(id);
    if (!session.info.exited) session.pty.kill(signal);
  }

  /** Kill (if running) and forget a session. */
  dispose(id: string): void {
    const session = this.#get(id);
    if (!session.info.exited) session.pty.kill("SIGKILL");
    session.mirror.dispose();
    this.#sessions.delete(id);
    this.#subscribers.delete(id);
  }

  /**
   * Subscribe to a session and get a snapshot of its screen. Output arriving while the snapshot
   * is being taken is buffered and delivered after it, so nothing is lost or duplicated.
   */
  attach(id: string, subscriber: Subscriber): Promise<AttachResult> {
    this.#get(id); // throws for unknown sessions before subscribing
    const buffered: HostEvent[] = [];
    let live = false;
    const gate: Subscriber = (event) => (live ? subscriber(event) : buffered.push(event));
    this.#subscribers.set(id, (this.#subscribers.get(id) ?? new Set()).add(gate));
    gateOf.set(subscriber, gate);

    return this.snapshot(id).then((result) => {
      queueMicrotask(() => {
        live = true;
        for (const event of buffered.splice(0)) subscriber(event);
      });
      return result;
    });
  }

  /** The session's screen as of now, and the output sequence it covers. Doesn't subscribe. */
  snapshot(id: string): Promise<AttachResult> {
    const session = this.#get(id);
    const seq = session.seq;
    return new Promise((resolve) => {
      // Resolves once every write queued before this call has reached the mirror.
      session.mirror.write("", () => {
        resolve({
          snapshot: session.serializer.serialize(),
          cols: session.info.cols,
          rows: session.info.rows,
          exited: session.info.exited,
          seq,
        });
      });
    });
  }

  /** The session's visible screen as styled runs, once queued output has reached the mirror. */
  screen(id: string): Promise<ScreenFrame> {
    const session = this.#get(id);
    return new Promise((resolve) =>
      session.mirror.write("", () => resolve(readScreen(session.mirror))),
    );
  }

  /** Receive events from every session, current and future (no snapshots). */
  attachAll(subscriber: Subscriber): void {
    this.#wildcard.add(subscriber);
  }

  detach(id: string, subscriber: Subscriber): void {
    const gate = gateOf.get(subscriber);
    if (gate) this.#subscribers.get(id)?.delete(gate);
  }

  /** Remove a subscriber everywhere (its connection closed). */
  unsubscribe(subscriber: Subscriber): void {
    this.#wildcard.delete(subscriber);
    const gate = gateOf.get(subscriber);
    if (!gate) return;
    for (const set of this.#subscribers.values()) set.delete(gate);
  }

  disposeAll(): void {
    for (const id of this.#sessions.keys()) this.dispose(id);
  }

  #get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`No such session: ${id}`);
    return session;
  }

  #emit(event: HostEvent): void {
    for (const subscriber of this.#subscribers.get(event.id) ?? []) subscriber(event);
    for (const subscriber of this.#wildcard) subscriber(event);
  }
}

const gateOf = new WeakMap<Subscriber, Subscriber>();

/** Fail fast (with a clear error) instead of letting the PTY child die on exec. */
function resolveCommand(command: string, path: string): string {
  const candidates = command.includes("/")
    ? [command]
    : path.split(delimiter).map((dir) => join(dir, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`Command not found: ${command}`);
}
