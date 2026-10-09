import type { ScreenFrame, ServerMsg } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import { ScreenRelay, type ScreenSource } from "../../src/features/crew/screens.server.ts";

function fakeSource() {
  const screens = new Map<string, ScreenFrame>();
  const listeners = new Set<(event: { crewId: string }) => void>();
  let reads = 0;
  const source: ScreenSource = {
    async screen(crewId) {
      reads++;
      const frame = screens.get(crewId);
      if (!frame) throw new Error(`No session ${crewId}`);
      return frame;
    },
    onOutput(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const output = (crewId: string, text: string) => {
    screens.set(crewId, { cols: 80, rows: 1, lines: [[[text, -1, -1, 0]]] });
    for (const listener of listeners) listener({ crewId });
  };
  return { source, output, reads: () => reads };
}

describe("ScreenRelay", () => {
  test("sends a crew screen once it has output, and only when it changed", async () => {
    const { source, output, reads } = fakeSource();
    const sent: ServerMsg[] = [];
    const relay = new ScreenRelay(source, (msg) => sent.push(msg));

    await relay.flush();
    expect(reads()).toBe(0);

    output("nova", "hello");
    await relay.flush();
    expect(sent).toEqual([
      {
        type: "crew.screen",
        crewId: "nova",
        frame: { cols: 80, rows: 1, lines: [[["hello", -1, -1, 0]]] },
      },
    ]);

    output("nova", "hello");
    await relay.flush();
    expect(sent).toHaveLength(1);

    output("nova", "bye");
    await relay.flush();
    expect(sent).toHaveLength(2);
  });

  test("keeps the last screen for browsers that connect later", async () => {
    const { source, output } = fakeSource();
    const relay = new ScreenRelay(source, () => {});
    output("nova", "hello");
    await relay.flush();
    expect(relay.current()).toMatchObject([{ type: "crew.screen", crewId: "nova" }]);
    relay.forget("nova");
    expect(relay.current()).toEqual([]);
  });

  test("a gone session is skipped quietly", async () => {
    const { source } = fakeSource();
    const sent: ServerMsg[] = [];
    const relay = new ScreenRelay(source, (msg) => sent.push(msg));
    relay.touch(["ghost"]);
    await relay.flush();
    expect(sent).toEqual([]);
  });
});
