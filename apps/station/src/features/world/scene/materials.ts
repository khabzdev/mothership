// The station's material language: the Kenney Space Station Kit's palette (its colormap), lit like
// the KayKit models (MeshStandardMaterial), so hand-built parts sit next to the kit's pieces.

export const KIT = {
  /** Bulkhead lavender, the kit's main panel colour. */
  hull: "#a0a8c9",
  /** Shaded panels and door frames. */
  slate: "#868ba1",
  /** Dark metal: frames, bezels, the inside of the lift. */
  charcoal: "#38383d",
  /** The kit's orange trim. */
  orange: "#ff7e44",
  amber: "#ffc044",
  /** Pale blue light (lamps, the lift's ceiling). */
  ice: "#d0e8ff",
  /** Alarm red. */
  alarm: "#ff3b3b",
} as const;

/** Roughness and metalness for painted metal panels (the kit's look, not shiny chrome). */
export const PAINTED = { roughness: 0.62, metalness: 0.15 } as const;

/** Emissive strength above 1 so bloom picks a light up; everything else stays below it. */
export const GLOW = 2.4;
