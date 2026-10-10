/** Where one instance of a piece stands: a position, a turn about Y and a uniform scale. */
export interface Placement {
  position: [number, number, number];
  rotY: number;
  scale: number;
}
