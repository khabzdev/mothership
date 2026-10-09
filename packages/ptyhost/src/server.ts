import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { decodeFrame } from "./frames.ts";
import type { HostEvent, HostFrame, RequestFrame } from "./protocol.ts";
import { SessionManager, type Subscriber } from "./sessions.ts";

export interface HostState {
  port: number;
  token: string;
  pid: number;
}

export interface PtyHost extends HostState {
  close(): Promise<void>;
}

export interface StartOptions {
  /** Mothership home; the state file is written to `<home>/ptyhost.json`. */
  home: string;
  /** Port to listen on (127.0.0.1). Defaults to a random free port. */
  port?: number;
}

export function stateFile(home: string): string {
  return join(home, "ptyhost.json");
}

/** Start a PTY host on 127.0.0.1 and publish its port and token to the state file. */
export async function startPtyHost({ home, port = 0 }: StartOptions): Promise<PtyHost> {
  const token = randomBytes(32).toString("hex");
  const sessions = new SessionManager();
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port,
    verifyClient: ({ req }, done) => {
      const ok = tokenMatches(req.headers.authorization, token);
      done(ok, ok ? undefined : 401, ok ? undefined : "Unauthorized");
    },
  });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  wss.on("connection", (socket) => serve(socket, sessions));

  const state: HostState = { port: (wss.address() as AddressInfo).port, token, pid: process.pid };
  mkdirSync(home, { recursive: true });
  writeFileSync(stateFile(home), JSON.stringify(state), { mode: 0o600 });

  return {
    ...state,
    close: async () => {
      sessions.disposeAll();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      rmSync(stateFile(home), { force: true });
    },
  };
}

function serve(socket: WebSocket, sessions: SessionManager): void {
  const send = (frame: HostFrame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };
  const subscriber: Subscriber = (event: HostEvent) => send(event);

  socket.on("message", async (raw) => {
    let frame: RequestFrame;
    try {
      frame = decodeFrame<RequestFrame>(raw);
    } catch {
      return;
    }
    try {
      const result = await handle(frame, sessions, subscriber);
      send({ type: "response", reqId: frame.reqId, ok: true, result });
    } catch (error) {
      send({ type: "response", reqId: frame.reqId, ok: false, error: (error as Error).message });
    }
  });
  socket.on("close", () => sessions.unsubscribe(subscriber));
}

async function handle(frame: RequestFrame, sessions: SessionManager, subscriber: Subscriber) {
  switch (frame.type) {
    case "ping":
      return "pong";
    case "list":
      return sessions.list();
    case "spawn": {
      const { reqId: _reqId, type: _type, ...spec } = frame;
      return sessions.spawn(spec);
    }
    case "write":
      return (sessions.write(frame.id, frame.data), null);
    case "resize":
      return (sessions.resize(frame.id, frame.cols, frame.rows), null);
    case "kill":
      return (sessions.kill(frame.id, frame.signal), null);
    case "dispose":
      return (sessions.dispose(frame.id), null);
    case "attach":
      return sessions.attach(frame.id, subscriber);
    case "attachAll":
      return (sessions.attachAll(subscriber), null);
    case "detach":
      return (sessions.detach(frame.id, subscriber), null);
    default:
      throw new Error(`Unknown request: ${(frame as { type: string }).type}`);
  }
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
