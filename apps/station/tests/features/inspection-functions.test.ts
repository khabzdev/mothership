import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const station = vi.hoisted(() => ({
  inspections: {
    history: vi.fn(),
    inspect: vi.fn(),
    setEnabled: vi.fn(),
  },
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

const { getInspections, reinspect, setInspector } =
  await import("../../src/features/inspection/inspection.functions.ts");

beforeEach(() => vi.resetAllMocks());

describe("inspection server functions", () => {
  test("getInspections returns the station's history", async () => {
    const records = [{ id: "i2" }, { id: "i1" }];
    station.inspections.history.mockReturnValue(records);
    expect(await getInspections({ data: { crewId: "c1" } })).toEqual(records);
    expect(station.inspections.history).toHaveBeenCalledWith("c1");
  });

  test("reinspect reports started: false when one is already going", async () => {
    station.inspections.inspect.mockResolvedValue(null);
    expect(await reinspect({ data: { crewId: "c1" } })).toEqual({ started: false });
    expect(station.inspections.inspect).toHaveBeenCalledWith("c1", "manual");
  });

  test("reinspect reports started: true with an inspection id", async () => {
    station.inspections.inspect.mockResolvedValue("i3");
    expect(await reinspect({ data: { crewId: "c1" } })).toEqual({ started: true });
  });

  test("setInspector rejects a non-boolean and passes a boolean on", async () => {
    await expect(setInspector({ data: { deckId: "d1", on: "yes" as never } })).rejects.toThrow();
    expect(station.inspections.setEnabled).not.toHaveBeenCalled();
    await setInspector({ data: { deckId: "d1", on: false } });
    expect(station.inspections.setEnabled).toHaveBeenCalledWith("d1", false);
  });
});
