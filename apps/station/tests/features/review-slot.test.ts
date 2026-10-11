import { describe, expect, test } from "vite-plus/test";
import { ReviewSlot } from "../../src/features/inspection/slot.server.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("ReviewSlot", () => {
  test("with one slot, the second acquirer waits for the first's release", async () => {
    const slot = new ReviewSlot(1);
    const first = await slot.acquire();
    expect(first).toBeTypeOf("function");
    let second: (() => void) | null | undefined;
    void slot.acquire().then((r) => (second = r));
    await tick();
    expect(second).toBeUndefined();
    first!();
    await tick();
    expect(second).toBeTypeOf("function");
  });

  test("waiters are served first in, first out", async () => {
    const slot = new ReviewSlot(1);
    const release = await slot.acquire();
    const order: string[] = [];
    void slot.acquire().then((r) => {
      order.push("a");
      r!();
    });
    void slot.acquire().then((r) => {
      order.push("b");
      r!();
    });
    release!();
    await tick();
    expect(order).toEqual(["a", "b"]);
  });

  test("aborted while waiting → null, and the next waiter still gets the slot", async () => {
    const slot = new ReviewSlot(1);
    const release = await slot.acquire();
    const abort = new AbortController();
    const dropped = slot.acquire(abort.signal);
    let next: (() => void) | null | undefined;
    void slot.acquire().then((r) => (next = r));
    abort.abort();
    expect(await dropped).toBeNull();
    release!();
    await tick();
    expect(next).toBeTypeOf("function");
  });

  test("an already-aborted signal never takes the slot", async () => {
    const slot = new ReviewSlot(1);
    const abort = new AbortController();
    abort.abort();
    expect(await slot.acquire(abort.signal)).toBeNull();
    expect(await slot.acquire()).toBeTypeOf("function");
  });

  test("releasing twice frees only one slot", async () => {
    const slot = new ReviewSlot(1);
    const release = await slot.acquire();
    const got: string[] = [];
    void slot.acquire().then(() => got.push("a"));
    void slot.acquire().then(() => got.push("b"));
    release!();
    release!();
    await tick();
    expect(got).toEqual(["a"]);
  });
});
