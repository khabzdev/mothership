import type { Mission } from "@mothership/mission-engine";
import { encode, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "@mothership/protocol";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";
import { applyServerMsg, realtimeKeys } from "../../src/shared/realtime/cache.ts";
import { RealtimeClient, type SocketLike } from "../../src/shared/realtime/client.ts";
import { RealtimeHub, isSameOrigin, type Peer } from "../../src/shared/realtime/hub.server.ts";

const mission: Mission = {
  state: "building",
  brief: { goal: "g", criteria: [{ id: "t", kind: "command", command: "vp test" }] },
  attempts: 1,
  maxAttempts: 3,
};

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/_ws", { headers });

  test("accepts a page served by the station", () => {
    expect(isSameOrigin(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))).toBe(
      true,
    );
  });

  test.each([
    ["another site", { host: "127.0.0.1:3000", origin: "https://evil.example" }],
    ["another local port", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:5173" }],
    ["a missing origin", { host: "127.0.0.1:3000" }],
    ["a malformed origin", { host: "127.0.0.1:3000", origin: "not a url" }],
    ["a null origin", { host: "127.0.0.1:3000", origin: "null" }],
  ])("rejects %s", (_, headers) => {
    expect(isSameOrigin(req(headers))).toBe(false);
  });
});

describe("RealtimeHub", () => {
  function peer(): Peer & { sent: ServerMsg[] } {
    const sent: ServerMsg[] = [];
    return { id: crypto.randomUUID(), sent, send: (text: string) => sent.push(JSON.parse(text)) };
  }

  test("greets new peers with the protocol version", () => {
    const hub = new RealtimeHub();
    const p = peer();
    hub.open(p);
    expect(p.sent).toEqual([{ type: "hello", protocolVersion: PROTOCOL_VERSION }]);
  });

  test("dispatches valid client messages to handlers with the sending peer", () => {
    const hub = new RealtimeHub();
    const handler = vi.fn();
    hub.on("terminal.input", handler);
    const p = peer();
    hub.open(p);
    const msg: ClientMsg = { type: "terminal.input", crewId: "c1", data: "y\r" };
    hub.message(p, encode(msg));
    expect(handler).toHaveBeenCalledWith(msg, p);
  });

  test("answers malformed frames with an error and does not dispatch", () => {
    const hub = new RealtimeHub();
    const handler = vi.fn();
    hub.on("terminal.input", handler);
    const p = peer();
    hub.message(p, JSON.stringify({ type: "terminal.input", crewId: 5 }));
    expect(handler).not.toHaveBeenCalled();
    expect(p.sent).toEqual([{ type: "error", message: "Malformed message" }]);
  });

  test("reports handler failures to the peer", () => {
    const hub = new RealtimeHub();
    hub.on("terminal.attach", () => {
      throw new Error("No such crew: c9");
    });
    const p = peer();
    hub.message(p, encode({ type: "terminal.attach", crewId: "c9" }));
    expect(p.sent).toEqual([{ type: "error", message: "No such crew: c9" }]);
  });

  test("unsubscribing a handler stops dispatch", () => {
    const hub = new RealtimeHub();
    const handler = vi.fn();
    const off = hub.on("terminal.detach", handler);
    off();
    hub.message(peer(), encode({ type: "terminal.detach", crewId: "c1" }));
    expect(handler).not.toHaveBeenCalled();
  });

  test("broadcasts to open peers only", () => {
    const hub = new RealtimeHub();
    const a = peer();
    const b = peer();
    hub.open(a);
    hub.open(b);
    hub.close(b);
    const msg: ServerMsg = { type: "error", message: "hi" };
    hub.broadcast(msg);
    expect(a.sent.at(-1)).toEqual(msg);
    expect(b.sent.at(-1)).toEqual({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  });

  test("notifies close listeners so features can clean up per-peer state", () => {
    const hub = new RealtimeHub();
    const onClose = vi.fn();
    hub.onPeerClose(onClose);
    const p = peer();
    hub.open(p);
    hub.close(p);
    expect(onClose).toHaveBeenCalledWith(p);
  });
});

describe("applyServerMsg", () => {
  test("stores crew status under the crew's key", () => {
    const qc = new QueryClient();
    applyServerMsg(qc, {
      type: "crew.status",
      crewId: "c1",
      missionId: "m1",
      status: "working",
      activity: { tool: "Edit", filePath: "src/a.ts" },
    });
    expect(qc.getQueryData(realtimeKeys.crewStatus("c1"))).toEqual({
      missionId: "m1",
      status: "working",
      activity: { tool: "Edit", filePath: "src/a.ts" },
    });
  });

  test("stores mission updates under the mission's key", () => {
    const qc = new QueryClient();
    applyServerMsg(qc, { type: "mission.updated", missionId: "m1", deckId: "d1", mission });
    expect(qc.getQueryData(realtimeKeys.mission("m1"))).toEqual({ deckId: "d1", mission });
  });

  test("ignores messages that don't belong in the cache", () => {
    const qc = new QueryClient();
    applyServerMsg(qc, { type: "terminal.output", crewId: "c1", data: "x" });
    expect(qc.getQueryCache().getAll()).toEqual([]);
  });
});

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
}

describe("RealtimeClient", () => {
  function setup() {
    FakeSocket.instances = [];
    vi.useFakeTimers();
    const client = new RealtimeClient("ws://station/_ws", {
      createSocket: (url) => new FakeSocket(url),
    });
    return { client, socket: () => FakeSocket.instances.at(-1)! };
  }

  test("dispatches parsed server messages and tracks connection state", () => {
    const { client, socket } = setup();
    const received: ServerMsg[] = [];
    const states: string[] = [];
    client.onMessage((msg) => received.push(msg));
    client.onState((state) => states.push(state));
    client.connect();
    socket().open();
    socket().receive({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    socket().receive("garbage");
    expect(received).toEqual([{ type: "hello", protocolVersion: PROTOCOL_VERSION }]);
    expect(states).toEqual(["connecting", "open"]);
    client.close();
    vi.useRealTimers();
  });

  test("sends only while open", () => {
    const { client, socket } = setup();
    client.connect();
    const msg: ClientMsg = { type: "terminal.attach", crewId: "c1" };
    expect(client.send(msg)).toBe(false);
    socket().open();
    expect(client.send(msg)).toBe(true);
    expect(socket().sent).toEqual([encode(msg)]);
    client.close();
    vi.useRealTimers();
  });

  test("reconnects with growing backoff after the socket drops", () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    socket().close();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
    socket().close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(3);
    client.close();
    vi.useRealTimers();
  });

  test("a successful open resets the backoff", () => {
    const { client, socket } = setup();
    client.connect();
    socket().close();
    vi.advanceTimersByTime(500);
    socket().close();
    vi.advanceTimersByTime(1000);
    socket().open();
    socket().close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(4);
    client.close();
    vi.useRealTimers();
  });

  test("closing while still connecting waits for open, avoiding a browser warning", () => {
    const { client, socket } = setup();
    client.connect();
    const pending = socket();
    client.close();
    expect(pending.readyState).toBe(0);
    pending.open();
    expect(pending.readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  test("close stops reconnecting", () => {
    const { client, socket } = setup();
    client.connect();
    socket().open();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
