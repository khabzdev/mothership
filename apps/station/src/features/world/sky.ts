// The orbit sky around a deck: Earth below the island's north side, the Moon off to one side and
// the Sun exactly where the deck's key light comes from. The sky follows the camera (a skybox),
// so each body is a direction, a distance from the camera and a radius.

type Vec3 = [number, number, number];

/** The camera's far plane (Game.tsx): everything in the sky stays inside it. */
export const CAMERA_FAR = 400;

/** How far the camera can be from the deck's centre: a deck corner plus the longest camera boom. */
export const CAMERA_ROAM = 50;

/** Where the deck's directional light stands (Atmosphere.tsx); the Sun is in this direction. */
export const SUN_LIGHT: Vec3 = [-8, 18, 10];

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** Toward the Sun: the direction the deck's key light comes from (unit vector). */
export const SUN_DIRECTION: Vec3 = unit(SUN_LIGHT);

/** A unit vector at a compass bearing (degrees from north, -z, toward east, +x) and an elevation. */
function toward(bearing: number, elevation: number): Vec3 {
  const a = (bearing * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** A sphere this wide (degrees of angular radius) seen from this far away. */
const radiusFor = (distance: number, degrees: number) =>
  distance * Math.sin((degrees * Math.PI) / 180);

export interface Body {
  direction: Vec3;
  /** From the camera to the body's centre. */
  distance: number;
  radius: number;
}

// The default camera looks north-west (bearing ≈ -34°) and 24° down: Earth sits a little east of
// that, low enough that its top limb is a curved horizon at about eye level beyond the island.
export const EARTH = {
  direction: toward(-25, -32),
  distance: 240,
  radius: radiusFor(240, 31),
  /** The cloud sphere and the atmosphere shell, relative to the radius. */
  clouds: 1.012,
  atmosphere: 1.04,
  /** Radians per second: the clouds drift a little faster than the ground turns. */
  turn: 0.004,
  drift: 0.0065,
} as const satisfies Body & Record<string, unknown>;

/** Left of the default view, just above Earth's limb. */
export const MOON: Body = {
  direction: toward(-63, -3),
  distance: 200,
  radius: radiusFor(200, 2.4),
};

/** The Sun's disc; its glare sprite is `glare` times as wide. */
export const SUN = {
  direction: SUN_DIRECTION,
  distance: 205,
  radius: radiusFor(205, 1.6),
  glare: 9,
} as const satisfies Body & Record<string, unknown>;

/** drei <Stars> around the deck: behind every visible bit of the sky's bodies, inside the far plane. */
export const STARS = { radius: 270, depth: 50 } as const;

/** three.js r160 planet maps (NASA-derived), fetched by `vp run assets`. */
export const PLANET_TEXTURES = {
  day: "/textures/planets/earth_atmos_2048.jpg",
  night: "/textures/planets/earth_lights_2048.png",
  clouds: "/textures/planets/earth_clouds_1024.png",
  moon: "/textures/planets/moon_1024.jpg",
} as const;
