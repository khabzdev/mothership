import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const station = vi.hoisted(() => ({
  debrief: {
    list: vi.fn(),
    keep: vi.fn(),
    drop: vi.fn(),
    retire: vi.fn(),
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

const { getLessons, keepLesson, dropLesson, retireLesson } =
  await import("../../src/features/debrief/debrief.functions.ts");

beforeEach(() => vi.resetAllMocks());

describe("debrief server functions", () => {
  test("getLessons returns the deck's pending and kept lessons", async () => {
    const lessons = { pending: [{ id: "l1" }], kept: [{ id: "l2" }] };
    station.debrief.list.mockReturnValue(lessons);
    expect(await getLessons({ data: { deckId: "d1" } })).toEqual(lessons);
    expect(station.debrief.list).toHaveBeenCalledWith("d1");
  });

  test("getLessons rejects a missing deck", async () => {
    await expect(getLessons({ data: {} as never })).rejects.toThrow();
    expect(station.debrief.list).not.toHaveBeenCalled();
  });

  test("keep, drop and retire pass the lesson on and its answer back", async () => {
    station.debrief.keep.mockReturnValue({ ok: true });
    station.debrief.drop.mockReturnValue({ ok: false, message: "Already dropped" });
    station.debrief.retire.mockReturnValue({ ok: true });
    expect(await keepLesson({ data: { lessonId: "l1" } })).toEqual({ ok: true });
    expect(station.debrief.keep).toHaveBeenCalledWith("l1");
    expect(await dropLesson({ data: { lessonId: "l1" } })).toEqual({
      ok: false,
      message: "Already dropped",
    });
    expect(station.debrief.drop).toHaveBeenCalledWith("l1");
    expect(await retireLesson({ data: { lessonId: "l2" } })).toEqual({ ok: true });
    expect(station.debrief.retire).toHaveBeenCalledWith("l2");
  });

  test("an empty lesson id is refused before reaching the station", async () => {
    await expect(keepLesson({ data: { lessonId: " " } })).rejects.toThrow();
    await expect(dropLesson({ data: {} as never })).rejects.toThrow();
    await expect(retireLesson({ data: { lessonId: 3 } as never })).rejects.toThrow();
    expect(station.debrief.keep).not.toHaveBeenCalled();
    expect(station.debrief.drop).not.toHaveBeenCalled();
    expect(station.debrief.retire).not.toHaveBeenCalled();
  });
});
