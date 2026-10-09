import WebSocket from "ws";
import { decodeFrame } from "./frames.ts";
import type {
  ExitEvent,
  HostFrame,
  HostRequest,
  OutputEvent,
  ResultMap,
  SessionInfo,
  SpawnSpec,
} from "./protocol.ts";

type Listener<T> = (event: T) => void;

/** Connection from the station server to the PTY host. */
export class PtyHostClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  readonly #output = new Set<Listener<OutputEvent>>();
  readonly #exit = new Set<Listener<ExitEvent>>();
  readonly #close = new Set<() => void>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (raw) => this.#receive(decodeFrame<HostFrame>(raw)));
    socket.on("close", () => {
      for (const { reject } of this.#pending.values()) reject(new Error("PTY host disconnected"));
      this.#pending.clear();
      for (const listener of this.#close) listener();
    });
  }

  static connect({ port, token }: { port: number; token: string }): Promise<PtyHostClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(new PtyHostClient(socket)));
      socket.once("error", reject);
    });
  }

  ping = () => this.#request({ type: "ping" });
  list = (): Promise<SessionInfo[]> => this.#request({ type: "list" });
  spawn = (spec: SpawnSpec) => this.#request({ type: "spawn", ...spec });
  write = (id: string, data: string) => this.#request({ type: "write", id, data });
  resize = (id: string, cols: number, rows: number) =>
    this.#request({ type: "resize", id, cols, rows });
  kill = (id: string, signal?: string) =>
    this.#request({ type: "kill", id, ...(signal && { signal }) });
  dispose = (id: string) => this.#request({ type: "dispose", id });
  /** Stream one session's output, starting with a snapshot of its screen. */
  attach = (id: string) => this.#request({ type: "attach", id });
  /** A session's screen and the output sequence it covers, without subscribing. */
  snapshot = (id: string) => this.#request({ type: "snapshot", id });
  /** Stream events from every session (used by the station to track status). */
  attachAll = () => this.#request({ type: "attachAll" });
  detach = (id: string) => this.#request({ type: "detach", id });

  onOutput(listener: Listener<OutputEvent>): () => void {
    this.#output.add(listener);
    return () => this.#output.delete(listener);
  }

  onExit(listener: Listener<ExitEvent>): () => void {
    this.#exit.add(listener);
    return () => this.#exit.delete(listener);
  }

  /** Called when the connection to the host drops (host exited or was replaced). */
  onClose(listener: () => void): () => void {
    this.#close.add(listener);
    return () => this.#close.delete(listener);
  }

  close(): void {
    this.#socket.close();
  }

  #request<T extends HostRequest>(request: T): Promise<ResultMap[T["type"]]> {
    const reqId = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      this.#socket.send(JSON.stringify({ ...request, reqId }));
    });
  }

  #receive(frame: HostFrame): void {
    switch (frame.type) {
      case "response": {
        const pending = this.#pending.get(frame.reqId);
        this.#pending.delete(frame.reqId);
        if (frame.ok) pending?.resolve(frame.result);
        else pending?.reject(new Error(frame.error));
        return;
      }
      case "output":
        for (const listener of this.#output) listener(frame);
        return;
      case "exit":
        for (const listener of this.#exit) listener(frame);
    }
  }
}
