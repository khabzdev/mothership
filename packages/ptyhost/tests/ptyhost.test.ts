import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { PtyHostClient, ensurePtyHost, readHostState } from "../src/index.ts";
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

describe("ensurePtyHost", () => {
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
