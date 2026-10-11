import type { ServerMsg } from "@spaceship/protocol";
import type { AttachResult } from "@spaceship/ptyhost";
import { describe, expect, test } from "vite-plus/test";
import { TerminalRelay, type TerminalSource } from "../../src/features/crew/terminals.server.ts";
import type { Peer } from "../../src/shared/realtime/hub.server.ts";

class FakeSource implements TerminalSource {
  outputListeners = new Set<(e: { crewId: string; data: string; seq: number }) => void>();
  exitListeners = new Set<(e: { crewId: string; exitCode: number }) => void>();
  writes: [string, string][] = [];
  resizes: [string, number, number][] = [];
  pendingSnapshot: ((r: AttachResult) => void) | null = null;
  snapshotError: Error | null = null;

  snapshot(crewId: string): Promise<AttachResult> {
    if (this.snapshotError) return Promise.reject(this.snapshotError);
    if (crewId === "ghost") return Promise.reject(new Error("No such session: ghost"));
    return new Promise((resolve) => (this.pendingSnapshot = resolve));
  }
  async write(crewId: string, data: string) {
    this.writes.push([crewId, data]);
  }
  async resize(crewId: string, cols: number, rows: number) {
    this.resizes.push([crewId, cols, rows]);
  }
  onOutput(l: (e: { crewId: string; data: string; seq: number }) => void) {
    this.outputListeners.add(l);
    return () => this.outputListeners.delete(l);
  }
  onExit(l: (e: { crewId: string; exitCode: number }) => void) {
    this.exitListeners.add(l);
    return () => this.exitListeners.delete(l);
  }
  emit(crewId: string, data: string, seq: number) {
    for (const l of this.outputListeners) l({ crewId, data, seq });
  }
  exit(crewId: string, exitCode: number) {
    for (const l of this.exitListeners) l({ crewId, exitCode });
  }
  resolveSnapshot(snapshot: string, seq: number, exited = false) {
    this.pendingSnapshot!({ snapshot, cols: 120, rows: 32, exited, seq });
  }
}

function setup() {
  const source = new FakeSource();
  const sent = new Map<string, ServerMsg[]>();
  const relay = new TerminalRelay(source, (peer, msg) => {
    sent.set(peer.id, [...(sent.get(peer.id) ?? []), msg]);
  });
  const peer = (id: string): Peer => ({ id, send: () => {} });
  return { source, relay, sent, peer, of: (id: string) => sent.get(id) ?? [] };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TerminalRelay", () => {
  test("sends a snapshot, drops output it already covers, then streams the rest", async () => {
    const { source, relay, peer, of } = setup();
    const attached = relay.attach(peer("p1"), "crew-1");
    source.emit("crew-1", "old", 4); // in flight, already in the snapshot
    source.emit("crew-1", "new", 5); // after the snapshot point
    source.resolveSnapshot("SCREEN", 4);
    await attached;
    source.emit("crew-1", "live", 6);

    expect(of("p1")).toEqual([
      { type: "terminal.snapshot", crewId: "crew-1", data: "SCREEN", cols: 120, rows: 32 },
      { type: "terminal.output", crewId: "crew-1", data: "new" },
      { type: "terminal.output", crewId: "crew-1", data: "live" },
    ]);
  });

  test("only viewers of a crew member get its output", async () => {
    const { source, relay, peer, of } = setup();
    const attached = relay.attach(peer("p1"), "crew-1");
    source.resolveSnapshot("", 0);
    await attached;
    source.emit("crew-2", "elsewhere", 1);
    expect(of("p1")).toHaveLength(1);
  });

  test("an exited session sends its snapshot and then the exit", async () => {
    const { source, relay, peer, of } = setup();
    const attached = relay.attach(peer("p1"), "crew-1");
    source.resolveSnapshot("bye", 3, true);
    await attached;
    expect(of("p1").map((m) => m.type)).toEqual(["terminal.snapshot", "terminal.exit"]);
  });

  test("exits are forwarded to viewers", async () => {
    const { source, relay, peer, of } = setup();
    const attached = relay.attach(peer("p1"), "crew-1");
    source.resolveSnapshot("", 0);
    await attached;
    source.exit("crew-1", 137);
    expect(of("p1").at(-1)).toEqual({ type: "terminal.exit", crewId: "crew-1", code: 137 });
  });

  test("attaching to an unknown session fails and leaves no viewer behind", async () => {
    const { source, relay, peer, of } = setup();
    await expect(relay.attach(peer("p1"), "ghost")).rejects.toThrow("No such session: ghost");
    source.emit("ghost", "x", 1);
    expect(of("p1")).toEqual([]);
  });

  test("detaching stops output, including a pending attach", async () => {
    const { source, relay, peer, of } = setup();
    const p = peer("p1");
    const attached = relay.attach(p, "crew-1");
    relay.detach(p, "crew-1");
    source.resolveSnapshot("", 0);
    await attached;
    source.emit("crew-1", "x", 1);
    expect(of("p1")).toEqual([]);
  });

  test("a closed peer is removed everywhere", async () => {
    const { source, relay, peer, of } = setup();
    const p = peer("p1");
    const attached = relay.attach(p, "crew-1");
    source.resolveSnapshot("", 0);
    await attached;
    relay.closePeer(p);
    source.emit("crew-1", "x", 1);
    await flush();
    expect(of("p1")).toHaveLength(1);
  });

  test("input and resize require an attached viewer", async () => {
    const { source, relay, peer } = setup();
    const p = peer("p1");
    await expect(relay.input(p, "crew-1", "y\r")).rejects.toThrow("Attach to crew-1 first");
    await expect(relay.resize(p, "crew-1", 100, 30)).rejects.toThrow("Attach to crew-1 first");

    const attached = relay.attach(p, "crew-1");
    source.resolveSnapshot("", 0);
    await attached;
    await relay.input(p, "crew-1", "y\r");
    await relay.resize(p, "crew-1", 100, 30);
    expect(source.writes).toEqual([["crew-1", "y\r"]]);
    expect(source.resizes).toEqual([["crew-1", 100, 30]]);
  });
});
