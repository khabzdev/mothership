import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const station = vi.hoisted(() => ({
  log: { list: vi.fn(), entry: vi.fn(), runOutput: vi.fn() },
}));
// Server functions need a running Start context; run validator and handler directly instead.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (input: unknown): unknown => input;
    const builder = {
      validator(fn: typeof validate) {
        validate = fn;
        return builder;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return async (arg: { data: unknown }) => fn({ data: validate(arg.data) });
      },
    };
    return builder;
  },
}));
vi.mock("../../src/app/station.server", () => ({ getStation: () => station }));

const { getLog, getMission, getRunOutput } =
  await import("../../src/features/log/log.functions.ts");

beforeEach(() => vi.resetAllMocks());

describe("log server functions", () => {
  test("getLog lists the deck's first page, or the page after a cursor", async () => {
    station.log.list.mockReturnValue([{ id: "m1" }]);
    expect(await getLog({ data: { deckId: "d1" } })).toEqual([{ id: "m1" }]);
    expect(station.log.list).toHaveBeenLastCalledWith("d1", {});
    await getLog({ data: { deckId: "d1", before: { endedAt: 5, id: "m1" } } });
    expect(station.log.list).toHaveBeenLastCalledWith("d1", {
      before: { endedAt: 5, id: "m1" },
    });
  });

  test.each([
    ["a missing deck", {}],
    ["a non-string deck", { deckId: 4 }],
    ["a cursor without an id", { deckId: "d1", before: { endedAt: 5 } }],
    ["a cursor with a non-numeric time", { deckId: "d1", before: { endedAt: "5", id: "m" } }],
    ["a cursor with a non-string id", { deckId: "d1", before: { endedAt: 5, id: 7 } }],
    ["a cursor that isn't an object", { deckId: "d1", before: "m1" }],
  ])("getLog rejects %s", async (_, data) => {
    await expect(getLog({ data: data as never })).rejects.toThrow();
    expect(station.log.list).not.toHaveBeenCalled();
  });

  test("getMission returns the entry, or null when there is none", async () => {
    station.log.entry.mockReturnValueOnce({ id: "m1" }).mockReturnValueOnce(null);
    expect(await getMission({ data: { missionId: "m1" } })).toEqual({ id: "m1" });
    expect(station.log.entry).toHaveBeenCalledWith("m1");
    expect(await getMission({ data: { missionId: "gone" } })).toBeNull();
  });

  test("getMission rejects a missing or non-string id", async () => {
    await expect(getMission({ data: {} as never })).rejects.toThrow();
    await expect(getMission({ data: { missionId: 3 } as never })).rejects.toThrow();
    expect(station.log.entry).not.toHaveBeenCalled();
  });

  test("getRunOutput returns a pre-flight's failing checks with their output", async () => {
    station.log.runOutput.mockReturnValue([{ name: "test", tail: "boom" }]);
    expect(await getRunOutput({ data: { preflightId: "p1" } })).toEqual([
      { name: "test", tail: "boom" },
    ]);
    expect(station.log.runOutput).toHaveBeenCalledWith("p1");
  });

  test("getRunOutput rejects a missing or non-string id", async () => {
    await expect(getRunOutput({ data: {} as never })).rejects.toThrow();
    await expect(getRunOutput({ data: { preflightId: ["p1"] } as never })).rejects.toThrow();
    expect(station.log.runOutput).not.toHaveBeenCalled();
  });
});
