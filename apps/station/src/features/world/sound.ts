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

/** One soft rising pair: someone on another deck needs you (agent-office's reminder chime). */
export function playHeadsUp(): void {
  unlockSound();
  bell(784, 0, 0.14);
  bell(1047, 0.13, 0.14);
}

/** Two notes up: a crew member finished its turn. */
export function playDone(): void {
  unlockSound();
  bell(660, 0, 0.3, 0.25);
  bell(880, 0.12, 0.3, 0.25);
}

/** The lift's doors opening: one soft low ding (only if sound is already on). */
export function playLiftChime(): void {
  if (ctx?.state !== "running") return;
  bell(523, 0, 0.12, 0.6);
}

// ---- Ambience: crew typing and the Captain's footsteps (agent-office's sound/typing.ts, feet.ts) ----

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

let clickBuffer: AudioBuffer | null = null;

/** A short burst of decaying noise: filtered, it's a key, a space bar, a mouse click or a step. */
function click(): AudioBuffer {
  if (clickBuffer) return clickBuffer;
  const length = Math.floor(ctx!.sampleRate * 0.06);
  clickBuffer = ctx!.createBuffer(1, length, ctx!.sampleRate);
  const data = clickBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 4;
  return clickBuffer;
}

type Sound = "key" | "space" | "enter" | "mouse" | "step";
const VOICES: Record<Sound, { filter: BiquadFilterType; freq: number; q: number; gain: number }> = {
  key: { filter: "bandpass", freq: 3800, q: 1.4, gain: 0.5 },
  space: { filter: "bandpass", freq: 1900, q: 1.2, gain: 0.55 },
  enter: { filter: "bandpass", freq: 1500, q: 1.1, gain: 0.75 },
  mouse: { filter: "highpass", freq: 4500, q: 0.7, gain: 0.35 },
  step: { filter: "lowpass", freq: 420, q: 0.8, gain: 0.5 },
};

function play(kind: Sound, when: number, dest: AudioNode): void {
  const voice = VOICES[kind];
  const src = ctx!.createBufferSource();
  src.buffer = click();
  src.playbackRate.value = rand(0.9, 1.1);
  const filter = ctx!.createBiquadFilter();
  filter.type = voice.filter;
  filter.frequency.value = voice.freq * rand(0.9, 1.1);
  filter.Q.value = voice.q;
  const gain = ctx!.createGain();
  gain.gain.value = voice.gain * rand(0.8, 1);
  src.connect(filter).connect(gain).connect(dest);
  src.start(when);
}

function panner(x: number, z: number): PannerNode {
  const p = ctx!.createPanner();
  p.panningModel = "equalpower";
  p.distanceModel = "inverse";
  p.refDistance = 1.2;
  p.rolloffFactor = 1.3;
  p.positionX.value = x;
  p.positionY.value = 0.9;
  p.positionZ.value = z;
  p.connect(ctx!.destination);
  return p;
}

/** Where you hear from: the Captain, facing where the camera looks. */
export function setListener(x: number, z: number, forwardX: number, forwardZ: number): void {
  if (!ctx || ctx.state !== "running") return;
  const l = ctx.listener;
  l.positionX.value = x;
  l.positionY.value = 1.4;
  l.positionZ.value = z;
  l.forwardX.value = forwardX;
  l.forwardY.value = 0;
  l.forwardZ.value = forwardZ;
}

interface Typist {
  on: boolean;
  out: PannerNode | null;
  x: number;
  z: number;
  /** When (audio clock) the next key lands, keys left in this burst and in this word. */
  next: number;
  left: number;
  word: number;
}

const typists = new Map<string, Typist>();

/** Crew member `id` at (x, z) types while `on`. */
export function setTyping(id: string, x: number, z: number, on: boolean): void {
  let t = typists.get(id);
  if (!t) typists.set(id, (t = { on: false, out: null, x, z, next: 0, left: 0, word: 0 }));
  if (on && !t.on) t.next = 0;
  t.on = on;
  t.x = x;
  t.z = z;
}

export function removeTypist(id: string): void {
  typists.get(id)?.out?.disconnect();
  typists.delete(id);
}

/** Schedule the next keys a little ahead on the audio clock, so the rhythm doesn't wobble with frames. */
export function scheduleTyping(): void {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const horizon = now + 0.12;
  for (const t of typists.values()) {
    if (!t.on) continue;
    t.out ??= panner(t.x, t.z);
    // Just started, or fell behind while the tab was hidden: begin again shortly.
    if (t.next < now - 0.25) {
      t.next = now + rand(0.05, 0.8);
      t.left = 0;
    }
    while (t.next < horizon) {
      const when = t.next;
      if (t.left === 0) {
        t.left = randInt(6, 36);
        t.word = randInt(2, 8);
        // Now and then it clicks around before typing again.
        if (Math.random() < 0.3) {
          play("mouse", when, t.out);
          if (Math.random() < 0.5) play("mouse", when + rand(0.1, 0.16), t.out);
          t.next = when + rand(0.4, 1.2);
          continue;
        }
      }
      t.left--;
      if (t.left === 0) {
        // End of a burst: often Enter, then a pause to read or think.
        play(Math.random() < 0.4 ? "enter" : "key", when, t.out);
        t.next = when + (Math.random() < 0.15 ? rand(4, 9) : rand(0.6, 3));
      } else if (--t.word <= 0) {
        play("space", when, t.out);
        t.word = randInt(2, 8);
        t.next = when + rand(0.1, 0.22);
      } else {
        play("key", when, t.out);
        t.next = when + rand(0.065, 0.16);
      }
    }
  }
}

let stride = 0;

/** The Captain's feet: a soft step every stride while walking, quicker running. */
export function footsteps(dt: number, moving: boolean, running: boolean): void {
  if (!moving) {
    stride = 0.15;
    return;
  }
  stride -= dt;
  if (stride > 0 || !ctx || ctx.state !== "running") return;
  stride = running ? 0.27 : 0.38;
  play("step", ctx.currentTime, ctx.destination);
}

/**
 * The launch klaxon (agent-office's merge gong, on a starship): two rising wails, then the rumble
 * of a rocket lifting off.
 */
export function playLaunch(): void {
  unlockSound();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.18;
  out.connect(ctx.destination);
  for (let i = 0; i < 2; i++) {
    const at = t0 + i * 0.9;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(420, at);
    o.frequency.linearRampToValueAtTime(880, at + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(1, at + 0.05);
    g.gain.setValueAtTime(1, at + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    o.connect(tone).connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.9);
  }
  // The rumble: low noise swelling as it lifts off, then fading as it climbs away.
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 160;
  const g = ctx.createGain();
  const at = t0 + 1.7;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(2.4, at + 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 4);
  noise.connect(low).connect(g).connect(out);
  noise.start(at);
  noise.stop(at + 4);
}

/** A pre-flight check's verdict: a bright blip for GO, a low double buzz for NO-GO (only if sound is on). */
export function playCheck(verdict: "go" | "nogo" | "skipped"): void {
  if (ctx?.state !== "running" || verdict === "skipped") return;
  if (verdict === "go") bell(988, 0, 0.12, 0.18);
  else {
    bell(196, 0, 0.16, 0.2);
    bell(185, 0.14, 0.16, 0.26);
  }
}

/** Say a line aloud, dropping whatever was still queued; silent where speech isn't available. */
export function speak(line: string): void {
  if (ctx?.state !== "running" || typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(line));
}
