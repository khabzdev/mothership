import {
  encode,
  parseClientMsg,
  PROTOCOL_VERSION,
  type ClientMsg,
  type MsgOf,
  type ServerMsg,
} from "@spaceship/protocol";

export interface Peer {
  id: string;
  send(text: string): void;
}

type Handler<T extends ClientMsg["type"]> = (msg: MsgOf<ClientMsg, T>, peer: Peer) => void;
type AnyHandler = (msg: ClientMsg, peer: Peer) => void;

/** Server side of the station socket: tracks browser peers, routes client messages to features. */
export class RealtimeHub {
  readonly #peers = new Map<string, Peer>();
  readonly #handlers = new Map<ClientMsg["type"], Set<AnyHandler>>();
  readonly #closeListeners = new Set<(peer: Peer) => void>();
  readonly #openListeners = new Set<(peer: Peer) => void>();

  open(peer: Peer): void {
    this.#peers.set(peer.id, peer);
    this.send(peer, { type: "hello", protocolVersion: PROTOCOL_VERSION });
    for (const listener of this.#openListeners) listener(peer);
  }

  close(peer: Peer): void {
    this.#peers.delete(peer.id);
    for (const listener of this.#closeListeners) listener(peer);
  }

  message(peer: Peer, text: string): void {
    const msg = parseClientMsg(text);
    if (!msg) {
      this.send(peer, { type: "error", message: "Malformed message" });
      return;
    }
    try {
      for (const handler of this.#handlers.get(msg.type) ?? []) handler(msg, peer);
    } catch (error) {
      this.send(peer, { type: "error", message: (error as Error).message });
    }
  }

  on<T extends ClientMsg["type"]>(type: T, handler: Handler<T>): () => void {
    // Only messages of `type` are dispatched to this set, so the narrowing is safe.
    const wrapped: AnyHandler = (msg, peer) => handler(msg as MsgOf<ClientMsg, T>, peer);
    const set = this.#handlers.get(type) ?? new Set();
    set.add(wrapped);
    this.#handlers.set(type, set);
    return () => set.delete(wrapped);
  }

  onPeerOpen(listener: (peer: Peer) => void): () => void {
    this.#openListeners.add(listener);
    return () => this.#openListeners.delete(listener);
  }

  onPeerClose(listener: (peer: Peer) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  send(peer: Peer, msg: ServerMsg): void {
    peer.send(encode(msg));
  }

  broadcast(msg: ServerMsg): void {
    const text = encode(msg);
    for (const peer of this.#peers.values()) peer.send(text);
  }
}

/**
 * WebSockets aren't covered by CORS, so any website could otherwise connect to the station on
 * 127.0.0.1 and type into crew terminals. Only pages served by the station itself may connect.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const shared = globalThis as typeof globalThis & { __spaceshipHub?: RealtimeHub };

/** The station's hub, shared across module reloads in dev. */
export const hub: RealtimeHub = (shared.__spaceshipHub ??= new RealtimeHub());
