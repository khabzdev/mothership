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
      | "crew.preflight"
      | "crew.brief"
      | "deck.labels"
      | "deck.checks"
      | "deck.clones"
      | "pr.merged"
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
      type: "crew.roster",
      deckId: "d1",
      crew: [
        {
          ...nova,
          preflight: {
            state: "running",
            checks: [{ name: "check", verdict: "go" }, { name: "test" }],
            attempt: 1,
            fuel: 3,
            maxFuel: 3,
          },
        },
      ],
    },
    {
      type: "crew.preflight",
      deckId: "d1",
      crewId: "c1",
      preflightId: "p1",
      check: "test",
      verdict: "nogo",
      done: true,
    },
    {
      type: "crew.roster",
      deckId: "d1",
      crew: [
        { ...nova, brief: { revision: 2, state: "waiting", goal: "Ship it" }, cleanBriefs: 3 },
      ],
    },
    { type: "crew.brief", deckId: "d1", crewId: "c1" },
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
    {
      type: "deck.checks",
      deckId: "d1",
      armed: null,
      checks: [{ id: "k1", name: "test", command: "vp test", timeoutMs: 300000, enabled: true }],
    },
    {
      type: "deck.clones",
      clones: [{ id: "k1", spec: "o/r", name: "r", state: "cloning", progress: "Downloading 5%" }],
    },
    { type: "pr.merged", deckId: "d1", number: 7, title: "Add toggle", crewId: "c1" },
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

  test("rejects a roster with a malformed pre-flight summary", () => {
    const preflight = { state: "flying", checks: [], attempt: 1, fuel: 3, maxFuel: 3 };
    const raw = JSON.stringify({
      type: "crew.roster",
      deckId: "d1",
      crew: [{ ...nova, preflight }],
    });
    expect(parseServerMsg(raw)).toBeNull();
    const badCheck = { ...preflight, state: "go", checks: [{ name: "test", verdict: "maybe" }] };
    expect(
      parseServerMsg(
        JSON.stringify({
          type: "crew.roster",
          deckId: "d1",
          crew: [{ ...nova, preflight: badCheck }],
        }),
      ),
    ).toBeNull();
  });

  test("rejects a roster with a malformed brief or clean-brief count", () => {
    const roster = (extra: object) =>
      JSON.stringify({ type: "crew.roster", deckId: "d1", crew: [{ ...nova, ...extra }] });
    const brief = { revision: 1, state: "waiting", goal: "g" };
    expect(parseServerMsg(roster({ brief: { ...brief, state: "pondering" } }))).toBeNull();
    expect(parseServerMsg(roster({ brief: { ...brief, revision: 0 } }))).toBeNull();
    expect(parseServerMsg(roster({ brief: { ...brief, goal: 5 } }))).toBeNull();
    expect(parseServerMsg(roster({ cleanBriefs: -1 }))).toBeNull();
    expect(parseServerMsg(roster({ cleanBriefs: 1.5 }))).toBeNull();
  });

  test("rejects a crew.brief without a crewId", () => {
    expect(parseServerMsg(JSON.stringify({ type: "crew.brief", deckId: "d1" }))).toBeNull();
  });

  test("rejects a crew.preflight with an unknown verdict or no done flag", () => {
    const msg = {
      type: "crew.preflight",
      deckId: "d1",
      crewId: "c1",
      preflightId: "p1",
      check: "test",
      verdict: "go",
      done: false,
    };
    expect(parseServerMsg(JSON.stringify({ ...msg, verdict: "maybe" }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ ...msg, done: undefined }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ ...msg, preflightId: "" }))).toBeNull();
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
