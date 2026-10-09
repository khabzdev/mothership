import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { spawn as spawnProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import { decodeFrame } from "../src/frames.ts";
import { HOST_VERSION, PtyHostClient, ensurePtyHost, readHostState } from "../src/index.ts";
import { startPtyHost, type PtyHost } from "../src/server.ts";

let home: string;
let host: PtyHost;
const clients: PtyHostClient[] = [];

async function connect() {
  const client = await PtyHostClient.connect(host);
  clients.push(client);
  return client;
}

/** Collect a session's output until `predicate` matches. */
function waitForOutput(client: PtyHostClient, id: string, predicate: (all: string) => boolean) {
  return new Promise<string>((resolve) => {
    let all = "";
    const off = client.onOutput((event) => {
      if (event.id !== id) return;
      all += event.data;
      if (predicate(all)) {
        off();
        resolve(all);
      }
    });
  });
}

function waitForExit(client: PtyHostClient, id: string) {
  return new Promise<{ exitCode: number; signal?: number }>((resolve) => {
    const off = client.onExit((event) => {
      if (event.id !== id) return;
      off();
      resolve(event);
    });
  });
}

const spawnSpec = (id: string, command: string, args: string[] = []) => ({
  id,
  command,
  args,
  cwd: home,
  cols: 80,
  rows: 24,
});

beforeEach(async () => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "mothership-pty-")));
  host = await startPtyHost({ home });
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await host.close();
  rmSync(home, { recursive: true, force: true });
});

describe("host state", () => {
  test("writes a private state file with port and token", () => {
    const file = join(home, "ptyhost.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const state = JSON.parse(readFileSync(file, "utf8"));
    expect(state).toMatchObject({ port: host.port, token: host.token, pid: process.pid });
    expect(host.token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects clients with the wrong token", async () => {
    await expect(PtyHostClient.connect({ port: host.port, token: "nope" })).rejects.toThrow(
      /401|Unexpected server response/,
    );
  });
});

describe("sessions", () => {
  test("streams output and reports exit", async () => {
    const client = await connect();
    await client.attachAll();
    const output = waitForOutput(client, "s1", (all) => all.includes("hello-pty"));
    const exit = waitForExit(client, "s1");
    await client.spawn(spawnSpec("s1", "/bin/sh", ["-c", "echo hello-pty"]));
    expect(await output).toContain("hello-pty");
    expect(await exit).toMatchObject({ exitCode: 0 });
    expect(await client.list()).toEqual([
      expect.objectContaining({ id: "s1", cwd: home, exited: true, exitCode: 0 }),
    ]);
  });

  test("writes input to the terminal", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("cat", "/bin/cat"));
    await client.attach("cat");
    const echoed = waitForOutput(client, "cat", (all) => all.includes("ping"));
    await client.write("cat", "ping\r");
    expect(await echoed).toContain("ping");
  });

  test("resizes the terminal", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("size", "/bin/sh", ["-c", "read line; stty size"]));
    await client.attach("size");
    await client.resize("size", 100, 40);
    const size = waitForOutput(client, "size", (all) => /40 100/.test(all));
    await client.write("size", "\r");
    expect(await size).toMatch(/40 100/);
  });

  test("kills a session", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("sleepy", "/bin/sleep", ["30"]));
    await client.attach("sleepy");
    const exit = waitForExit(client, "sleepy");
    await client.kill("sleepy");
    expect((await exit).signal).toBeGreaterThan(0);
  });

  test("disposes a session", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("gone", "/bin/sleep", ["30"]));
    await client.dispose("gone");
    expect(await client.list()).toEqual([]);
  });

  test("rejects duplicate ids and unknown sessions", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("dup", "/bin/sleep", ["30"]));
    await expect(client.spawn(spawnSpec("dup", "/bin/sleep", ["30"]))).rejects.toThrow(
      "Session already exists: dup",
    );
    await expect(client.write("ghost", "x")).rejects.toThrow("No such session: ghost");
  });

  test("rejects a missing command", async () => {
    const client = await connect();
    await expect(client.spawn(spawnSpec("bad", "/no/such/binary"))).rejects.toThrow();
  });
});

describe("reattaching", () => {
  test("sessions outlive the client and a new client gets a snapshot", async () => {
    const first = await connect();
    await first.spawn(spawnSpec("crew", "/bin/sh", ["-c", "printf 'hello from crew'; cat"]));
    await first.attach("crew");
    await waitForOutput(first, "crew", (all) => all.includes("hello from crew"));
    first.close();

    const second = await connect();
    expect((await second.list()).map((s) => s.id)).toEqual(["crew"]);
    const attached = await second.attach("crew");
    expect(attached.snapshot).toContain("hello from crew");
    expect(attached).toMatchObject({ cols: 80, rows: 24, exited: false });

    const echoed = waitForOutput(second, "crew", (all) => all.includes("still here"));
    await second.write("crew", "still here\r");
    expect(await echoed).toContain("still here");
  });

  test("detached clients stop receiving output", async () => {
    const client = await connect();
    await client.spawn(spawnSpec("quiet", "/bin/cat"));
    await client.attach("quiet");
    await client.detach("quiet");
    let received = "";
    client.onOutput((event) => (received += event.data));
    await client.write("quiet", "shh\r");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toBe("");
  });
});

describe("sequenced output and snapshots", () => {
  test("output events carry an increasing per-session sequence number", async () => {
    const client = await connect();
    await client.attachAll();
    const seqs: number[] = [];
    client.onOutput((event) => event.id === "seq" && seqs.push(event.seq));
    await client.spawn(spawnSpec("seq", "/bin/cat"));
    const echoedA = waitForOutput(client, "seq", (all) => all.includes("a"));
    await client.write("seq", "a\r");
    await echoedA;
    const echoedB = waitForOutput(client, "seq", (all) => all.includes("b"));
    await client.write("seq", "b\r");
    await echoedB;
    expect(seqs.length).toBeGreaterThanOrEqual(2);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(seqs[0]).toBe(1);
  });

  test("a snapshot reports the sequence it covers and doesn't subscribe", async () => {
    const watcher = await connect();
    await watcher.attachAll();
    let lastSeq = 0;
    watcher.onOutput((event) => event.id === "snap" && (lastSeq = event.seq));
    await watcher.spawn(spawnSpec("snap", "/bin/sh", ["-c", "printf ready; cat"]));
    await waitForOutput(watcher, "snap", (all) => all.includes("ready"));

    const viewer = await connect();
    const snapshot = await viewer.snapshot("snap");
    expect(snapshot.snapshot).toContain("ready");
    expect(snapshot.seq).toBe(lastSeq);

    let viewerOutput = "";
    viewer.onOutput((event) => (viewerOutput += event.data));
    const echoed = waitForOutput(watcher, "snap", (all) => all.includes("more"));
    await watcher.write("snap", "more\r");
    await echoed;
    expect(viewerOutput).toBe("");
  });
});

describe("screens", () => {
  test("screen returns the visible rows as styled runs", async () => {
    const client = await connect();
    await client.attachAll();
    await client.spawn(
      spawnSpec("scr", "/bin/sh", ["-c", "printf 'plain \\033[1;31mred\\033[0m'; cat"]),
    );
    await waitForOutput(client, "scr", (all) => all.includes("red"));
    const frame = await client.screen("scr");
    expect(frame.rows).toBe(frame.lines.length);
    expect(frame.lines[0]).toEqual([
      ["plain ", -1, -1, 0],
      ["red", 1, -1, 1],
    ]);
    expect(frame.lines.at(-1)).toEqual([]);
  });
});

describe("host version", () => {
  test("ping reports the protocol version and the state file records it", async () => {
    const client = await connect();
    expect(await client.ping()).toEqual({ version: HOST_VERSION });
    expect(readHostState(home)?.version).toBe(HOST_VERSION);
  });
});

/** An old (v1) host: answers ping with "pong" and lists the given sessions. */
async function startOldHost(dir: string, sessions: { id: string; exited: boolean }[]) {
  const token = "t".repeat(64);
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  wss.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const frame = decodeFrame<{ reqId: number; type: string }>(raw);
      const result = frame.type === "ping" ? "pong" : frame.type === "list" ? sessions : null;
      socket.send(JSON.stringify({ type: "response", reqId: frame.reqId, ok: true, result }));
    }),
  );
  const dummy = spawnProcess("/bin/sleep", ["60"], { stdio: "ignore" });
  const port = (wss.address() as { port: number }).port;
  writeFileSync(join(dir, "ptyhost.json"), JSON.stringify({ port, token, pid: dummy.pid }));
  return { wss, dummy };
}

describe("ensurePtyHost", () => {
  test("replaces an outdated host that has no live crew", async () => {
    await host.close();
    const old = await startOldHost(home, [{ id: "done", exited: true }]);
    const entry = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
    try {
      const state = await ensurePtyHost({ home, entry });
      expect(state.pid).not.toBe(old.dummy.pid);
      expect(state.version).toBe(HOST_VERSION);
      expect(state.outdated).toBeUndefined();
      await expect
        .poll(() => old.dummy.exitCode !== null || old.dummy.signalCode !== null)
        .toBe(true);
      process.kill(state.pid, "SIGTERM");
    } finally {
      old.wss.close();
      host = await startPtyHost({ home: join(home, "spare") });
    }
  });

  test("keeps an outdated host with live crew, flagged as outdated", async () => {
    await host.close();
    const old = await startOldHost(home, [{ id: "busy", exited: false }]);
    try {
      const state = await ensurePtyHost({ home, entry: "/unused" });
      expect(state).toMatchObject({ pid: old.dummy.pid, outdated: true, liveSessions: 1 });
    } finally {
      old.dummy.kill();
      old.wss.close();
      host = await startPtyHost({ home: join(home, "spare") });
    }
  });

  test("launches a detached host once and reuses it", async () => {
    await host.close();
    const entry = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
    const first = await ensurePtyHost({ home, entry });
    try {
      expect(first.pid).not.toBe(process.pid);
      const second = await ensurePtyHost({ home, entry });
      expect(second).toEqual(first);
      expect(readHostState(home)).toEqual(first);

      const client = await PtyHostClient.connect(first);
      clients.push(client);
      expect(await client.list()).toEqual([]);
    } finally {
      process.kill(first.pid, "SIGTERM");
      host = await startPtyHost({ home: join(home, "spare") });
    }
  });
});
