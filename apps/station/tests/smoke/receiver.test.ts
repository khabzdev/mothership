import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { SmokeRegistry, startReceiver, type Signal } from "../../smoke/harness.ts";

let registry: SmokeRegistry;
let server: Server;
let url: string;
let recorded: { crewId: string; signal: Signal }[];

beforeEach(async () => {
  registry = new SmokeRegistry();
  recorded = [];
  ({ server, url } = await startReceiver(registry, (crewId, signal) =>
    recorded.push({ crewId, signal }),
  ));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const SESSION = "0b6f6c1e-5a3a-4d55-9a0e-3c1f2a7b9d10";

function post(crewId: string, token: string, body: unknown) {
  return fetch(`${url}/api/hooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spaceship-crew": crewId,
      "x-spaceship-token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("hook receiver", () => {
  test("a bad token is refused and records nothing", async () => {
    registry.register("crew-1", { missionId: "smoke", provider: "claude-code" });
    const response = await post("crew-1", "wrong", { hook_event_name: "Stop" });
    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  test("a verified hook is parsed by the provider and recorded for its crew member", async () => {
    const { token } = registry.register("crew-1", { missionId: "smoke", provider: "claude-code" });
    const payload = { hook_event_name: "Stop", session_id: SESSION };
    const response = await post("crew-1", token, payload);
    expect(response.status).toBe(204);
    expect(recorded).toEqual([
      {
        crewId: "crew-1",
        signal: {
          event: "Stop",
          signal: { type: "stopped" },
          sessionId: SESSION,
          payload,
          at: expect.any(Number),
        },
      },
    ]);
    expect(registry.tokens).toEqual(new Set([token]));
  });
});
