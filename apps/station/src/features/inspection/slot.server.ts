/** At most this many AI reviews run at once, station-wide; the rest wait their turn. */
export const MAX_REVIEWS = 1;

/** One acquirer waiting for its turn: `start` gets a release, or null when it was dropped. */
type Waiting = { start: (release: (() => void) | null) => void; signal?: AbortSignal };

/**
 * The station's `claude -p` slots, shared by the Inspector and the debrief so the two never run
 * more reviews at once than allowed. First come, first served.
 */
export class ReviewSlot {
  readonly #max: number;
  readonly #waiting: Waiting[] = [];
  #running = 0;

  constructor(max = MAX_REVIEWS) {
    this.#max = max;
  }

  /** Wait for a free slot: resolves its release, or null when `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<(() => void) | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      const onAbort = () => {
        const i = this.#waiting.indexOf(waiting);
        if (i >= 0) this.#waiting.splice(i, 1);
        resolve(null);
      };
      const waiting: Waiting = {
        signal,
        start: (release) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(release);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(waiting);
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#running < this.#max && this.#waiting.length > 0) {
      const next = this.#waiting.shift()!;
      if (next.signal?.aborted) {
        next.start(null);
        continue;
      }
      this.#running++;
      let released = false;
      next.start(() => {
        if (released) return;
        released = true;
        this.#running--;
        this.#pump();
      });
    }
  }
}
