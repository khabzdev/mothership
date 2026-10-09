import type { Mission } from "@mothership/mission-engine";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  PROTOCOL_VERSION,
  encode,
  parseClientMsg,
  parseServerMsg,
  type ClientMsg,
  type CrewActivity,
  type CrewStatus,
  type MsgOf,
  type ServerMsg,
} from "../src/index.ts";

const mission: Mission = {
  state: "building",
  brief: { goal: "g", criteria: [{ id: "t", kind: "command", command: "vp test" }] },
  attempts: 1,
  maxAttempts: 3,
};

describe("types", () => {
  test("message unions are discriminated by type", () => {
    expectTypeOf<ClientMsg["type"]>().toEqualTypeOf<
      "terminal.attach" | "terminal.detach" | "terminal.input" | "terminal.resize"
    >();
    expectTypeOf<ServerMsg["type"]>().toEqualTypeOf<
      | "hello"
      | "terminal.snapshot"
      | "terminal.output"
      | "terminal.exit"
      | "crew.status"
      | "mission.updated"
      | "error"
    >();
  });

  test("MsgOf narrows a union member by type", () => {
    expectTypeOf<MsgOf<ServerMsg, "terminal.output">>().toEqualTypeOf<{
      type: "terminal.output";
      crewId: string;
      data: string;
    }>();
  });

  test("crew status and activity shapes", () => {
    expectTypeOf<CrewStatus>().toEqualTypeOf<
      "offline" | "idle" | "working" | "redAlert" | "done"
    >();
    expectTypeOf<CrewActivity>().toEqualTypeOf<{
      tool: string;
      filePath?: string;
      command?: string;
    }>();
  });

  test("mission.updated carries the engine's Mission", () => {
    expectTypeOf<MsgOf<ServerMsg, "mission.updated">["mission"]>().toEqualTypeOf<Mission>();
  });
});

describe("encode", () => {
  test("serialises to JSON", () => {
    const msg: ServerMsg = { type: "hello", protocolVersion: PROTOCOL_VERSION };
    expect(JSON.parse(encode(msg))).toEqual(msg);
  });
});

describe("parseClientMsg", () => {
  const valid: ClientMsg[] = [
    { type: "terminal.attach", crewId: "c1" },
    { type: "terminal.detach", crewId: "c1" },
    { type: "terminal.input", crewId: "c1", data: "y\r" },
    { type: "terminal.resize", crewId: "c1", cols: 120, rows: 40 },
  ];

  for (const msg of valid) {
    test(`accepts ${msg.type}`, () => {
      expect(parseClientMsg(encode(msg))).toEqual(msg);
    });
  }

  test("drops unknown extra fields", () => {
    expect(parseClientMsg(JSON.stringify({ type: "terminal.attach", crewId: "c1", x: 1 }))).toEqual(
      { type: "terminal.attach", crewId: "c1" },
    );
  });

  const invalid: [string, string][] = [
    ["non-JSON", "{nope"],
    ["non-object", "42"],
    ["null", "null"],
    ["unknown type", JSON.stringify({ type: "crew.fire", crewId: "c1" })],
    ["server-only type", JSON.stringify({ type: "terminal.output", crewId: "c1", data: "x" })],
    ["missing crewId", JSON.stringify({ type: "terminal.attach" })],
    ["empty crewId", JSON.stringify({ type: "terminal.attach", crewId: "" })],
    ["non-string data", JSON.stringify({ type: "terminal.input", crewId: "c1", data: 5 })],
    [
      "fractional cols",
      JSON.stringify({ type: "terminal.resize", crewId: "c1", cols: 1.5, rows: 4 }),
    ],
    ["zero rows", JSON.stringify({ type: "terminal.resize", crewId: "c1", cols: 80, rows: 0 })],
    ["huge cols", JSON.stringify({ type: "terminal.resize", crewId: "c1", cols: 100000, rows: 4 })],
  ];

  for (const [name, raw] of invalid) {
    test(`rejects ${name}`, () => {
      expect(parseClientMsg(raw)).toBeNull();
    });
  }
});

describe("parseServerMsg", () => {
  const valid: ServerMsg[] = [
    { type: "hello", protocolVersion: PROTOCOL_VERSION },
    { type: "terminal.snapshot", crewId: "c1", data: "$ ", cols: 80, rows: 24 },
    { type: "terminal.output", crewId: "c1", data: "hi" },
    { type: "terminal.exit", crewId: "c1", code: 0 },
    { type: "terminal.exit", crewId: "c1", code: null },
    {
      type: "crew.status",
      crewId: "c1",
      missionId: "m1",
      status: "working",
      activity: { tool: "Edit", filePath: "src/app.ts" },
    },
    { type: "crew.status", crewId: "c1", missionId: null, status: "offline" },
    { type: "mission.updated", missionId: "m1", deckId: "d1", mission },
    { type: "error", message: "boom" },
  ];

  for (const msg of valid) {
    test(`accepts ${msg.type}`, () => {
      expect(parseServerMsg(encode(msg))).toEqual(msg);
    });
  }

  test("rejects an unknown crew status", () => {
    const raw = JSON.stringify({
      type: "crew.status",
      crewId: "c1",
      missionId: null,
      status: "asleep",
    });
    expect(parseServerMsg(raw)).toBeNull();
  });

  test("rejects a client-only type", () => {
    expect(parseServerMsg(JSON.stringify({ type: "terminal.attach", crewId: "c1" }))).toBeNull();
  });
});
