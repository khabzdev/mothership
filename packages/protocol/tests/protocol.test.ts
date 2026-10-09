import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  PROTOCOL_VERSION,
  encode,
  parseClientMsg,
  parseServerMsg,
  type ClientMsg,
  type CrewAction,
  type CrewInfo,
  type CrewStatus,
  type MsgOf,
  type ServerMsg,
} from "../src/index.ts";

const nova: CrewInfo = {
  id: "c1",
  kind: "agent",
  deckId: "d1",
  consoleId: 3,
  name: "Nova",
  color: "#ff5f1f",
  character: "Barbarian",
  task: "Add dark mode",
  status: "working",
  action: "edit",
  statusSince: 1,
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
      | "crew.roster"
      | "crew.screen"
      | "deck.labels"
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

  test("crew statuses and actions follow agent-office", () => {
    expectTypeOf<CrewStatus>().toEqualTypeOf<
      "starting" | "idle" | "working" | "needs_input" | "done" | "asleep"
    >();
    expectTypeOf<CrewAction>().toEqualTypeOf<"read" | "edit" | "test" | "web" | "failing">();
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
    { type: "crew.roster", deckId: "d1", crew: [nova] },
    { type: "crew.roster", deckId: "d1", crew: [] },
    {
      type: "crew.screen",
      crewId: "c1",
      frame: { cols: 80, rows: 2, lines: [[["hi", -1, -1, 0]], []] },
    },
    {
      type: "deck.labels",
      deckId: "d1",
      labels: [{ consoleId: 2, text: "Ops", color: "#118ab2" }],
    },
    { type: "error", message: "boom" },
  ];

  for (const msg of valid) {
    test(`accepts ${msg.type}`, () => {
      expect(parseServerMsg(encode(msg))).toEqual(msg);
    });
  }

  test("rejects a roster with an unknown crew status", () => {
    const raw = JSON.stringify({
      type: "crew.roster",
      deckId: "d1",
      crew: [{ ...nova, status: "asleep-ish" }],
    });
    expect(parseServerMsg(raw)).toBeNull();
  });

  test("rejects a screen with a malformed run", () => {
    const raw = JSON.stringify({
      type: "crew.screen",
      crewId: "c1",
      frame: { cols: 80, rows: 1, lines: [[["hi", "red", -1, 0]]] },
    });
    expect(parseServerMsg(raw)).toBeNull();
  });

  test("rejects a client-only type", () => {
    expect(parseServerMsg(JSON.stringify({ type: "terminal.attach", crewId: "c1" }))).toBeNull();
  });
});
