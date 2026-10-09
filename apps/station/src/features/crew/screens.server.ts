import type { ScreenFrame, ServerMsg } from "@mothership/protocol";

/** Where crew screens are read from (the PTY host, via the launcher). */
export interface ScreenSource {
  screen(crewId: string): Promise<ScreenFrame>;
  onOutput(listener: (event: { crewId: string }) => void): () => void;
}

/** How often changed screens are sent to browsers (ms): agent-office's laptops update at about 4 Hz. */
const FLUSH_MS = 250;

/**
 * Streams every crew terminal's visible screen to all browsers for the consoles' holo screens
 * (agent-office's flushScreens). Only screens that had output are read, and only changed ones sent.
 */
export class ScreenRelay {
  readonly #source: ScreenSource;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #dirty = new Set<string>();
  readonly #frames = new Map<string, { frame: ScreenFrame; key: string }>();
  #flushing = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(source: ScreenSource, broadcast: (msg: ServerMsg) => void) {
    this.#source = source;
    this.#broadcast = broadcast;
    source.onOutput(({ crewId }) => this.#dirty.add(crewId));
  }

  start(intervalMs = FLUSH_MS): void {
    this.#timer ??= setInterval(() => void this.flush(), intervalMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Read these crew's screens on the next flush (e.g. sessions found after a restart). */
  touch(crewIds: Iterable<string>): void {
    for (const id of crewIds) this.#dirty.add(id);
  }

  /** The last screen of every crew member, for a browser that has just connected. */
  current(): ServerMsg[] {
    return [...this.#frames].map(([crewId, { frame }]) => ({ type: "crew.screen", crewId, frame }));
  }

  forget(crewId: string): void {
    this.#dirty.delete(crewId);
    this.#frames.delete(crewId);
  }

  /** Send the screens that changed since the last flush. */
  async flush(): Promise<void> {
    if (this.#flushing) return;
    this.#flushing = true;
    try {
      const ids = [...this.#dirty];
      this.#dirty.clear();
      await Promise.all(ids.map((crewId) => this.#send(crewId)));
    } finally {
      this.#flushing = false;
    }
  }

  async #send(crewId: string): Promise<void> {
    let frame: ScreenFrame;
    try {
      frame = await this.#source.screen(crewId);
    } catch {
      // The session is gone: its last screen stays up.
      return;
    }
    const key = `${frame.cols}x${frame.rows}:${JSON.stringify(frame.lines)}`;
    if (this.#frames.get(crewId)?.key === key) return;
    this.#frames.set(crewId, { frame, key });
    this.#broadcast({ type: "crew.screen", crewId, frame });
  }
}
