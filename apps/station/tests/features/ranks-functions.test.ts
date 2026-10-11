import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const station = vi.hoisted(() => ({
  crew: { member: vi.fn() },
  ranks: { record: vi.fn() },
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

const { getServiceRecord } = await import("../../src/features/ranks/ranks.functions.ts");

beforeEach(() => vi.resetAllMocks());

describe("getServiceRecord", () => {
  test("reads the record of the crew member's call sign on its deck", async () => {
    const record = { missions: 1, merged: 1, patches: ["first-launch"] };
    station.crew.member.mockReturnValue({ id: "c1", deckId: "d1", name: "Nova" });
    station.ranks.record.mockReturnValue(record);
    expect(await getServiceRecord({ data: { crewId: "c1" } })).toEqual({ name: "Nova", record });
    expect(station.crew.member).toHaveBeenCalledWith("c1");
    expect(station.ranks.record).toHaveBeenCalledWith("d1", "Nova");
  });

  test("an empty crew id is refused before reaching the station", async () => {
    await expect(getServiceRecord({ data: { crewId: " " } })).rejects.toThrow();
    expect(station.crew.member).not.toHaveBeenCalled();
  });
});
