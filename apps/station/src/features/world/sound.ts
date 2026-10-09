// The deck's alerts, synthesised with Web Audio: agent-office's needs-you alarm and done ding.

let ctx: AudioContext | null = null;

/** Browsers only start audio after a gesture: the first key or click on the page opens it. */
export function unlockSound(): void {
  if (typeof window === "undefined") return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

/** A bell note: the tone, and a quieter one an octave up that dies away sooner. */
function bell(f: number, at: number, level: number, len = 0.34): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  for (const [mult, amp, l] of [
    [1, level, len],
    [2, level * 0.3, len / 2],
  ] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + l);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + l + 0.05);
  }
}

/** Two rising pairs, brighter and louder than the done ding, so one is never taken for the other. */
export function playNeedsYou(): void {
  unlockSound();
  for (const [f, at] of [
    [784, 0],
    [1047, 0.13],
    [784, 0.42],
    [1175, 0.55],
  ] as const) {
    bell(f, at, 0.34);
  }
}

/** Two notes up: a crew member finished its turn. */
export function playDone(): void {
  unlockSound();
  bell(660, 0, 0.3, 0.25);
  bell(880, 0.12, 0.3, 0.25);
}
