import { encode, parseServerMsg, type ClientMsg, type ServerMsg } from "@mothership/protocol";

export type ConnectionState = "connecting" | "open" | "closed";

/** The parts of the browser WebSocket the client uses (so tests can fake it). */
export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RealtimeClientOptions {
  createSocket?: (url: string) => SocketLike;
}

const CONNECTING = 0;
const OPEN = 1;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

/** Browser side of the station socket: typed messages, reconnect with exponential backoff. */
export class RealtimeClient {
  readonly #url: string;
  readonly #createSocket: (url: string) => SocketLike;
  readonly #messageListeners = new Set<(msg: ServerMsg) => void>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  #socket: SocketLike | null = null;
  #retries = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #state: ConnectionState = "closed";

  constructor(url: string, options: RealtimeClientOptions = {}) {
    this.#url = url;
    this.#createSocket =
      options.createSocket ?? ((target) => new WebSocket(target) as unknown as SocketLike);
  }

  get state(): ConnectionState {
    return this.#state;
  }

  connect(): void {
    this.#stopped = false;
    this.#setState("connecting");
    const socket = this.#createSocket(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      this.#retries = 0;
      this.#setState("open");
    };
    socket.onmessage = (event) => {
      const msg = typeof event.data === "string" ? parseServerMsg(event.data) : null;
      if (msg) for (const listener of this.#messageListeners) listener(msg);
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#setState("closed");
      if (!this.#stopped) this.#scheduleReconnect();
    };
  }

  /** Send a message; returns false (and drops it) while disconnected. */
  send(msg: ClientMsg): boolean {
    if (this.#socket?.readyState !== OPEN) return false;
    this.#socket.send(encode(msg));
    return true;
  }

  onMessage(listener: (msg: ServerMsg) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  close(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    const socket = this.#socket;
    this.#socket = null;
    if (socket?.readyState === CONNECTING) {
      // Closing mid-handshake makes browsers log a warning; close as soon as it opens instead.
      socket.onmessage = null;
      socket.onopen = () => socket.close();
    } else {
      socket?.close();
    }
    this.#setState("closed");
  }

  #scheduleReconnect(): void {
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.#retries, MAX_DELAY_MS);
    this.#retries++;
    this.#timer = setTimeout(() => this.connect(), delay);
  }

  #setState(state: ConnectionState): void {
    if (state === this.#state) return;
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }
}
