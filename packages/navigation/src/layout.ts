import type { Waypoint } from "./waypoints.ts";

/** Most top-level directories shown as modules; the rest belong to the hub. */
export const MAX_MODULES = 16;
export const MODULE_VARIANTS = 5;

const ROOM_SIZE = 3;
const SLOT_WIDTH = ROOM_SIZE + 1;
const FIRST_SLOT_X = 2;
const HEIGHT = 11;
const SPINE_Y = 5;
const TOP_ROOM_Y = 1;
const BOTTOM_ROOM_Y = SPINE_Y + 2;

export interface Point {
  x: number;
  y: number;
}

export type Tile = "edge" | "ground" | "corridor" | "room";

export interface Room extends Point {
  w: number;
  h: number;
  /** Walkable tile in front of the room where crew stand. */
  door: Point;
}

export interface ModuleRoom extends Room {
  id: string;
  /** Stable look variant (0–4) derived from the module name. */
  variant: number;
}

export type FacilityKind = "quarters" | "engineeringBay" | "preflightConsole" | "airlock";

export interface DeckLayout {
  width: number;
  height: number;
  spineY: number;
  /** Row-major tile grid. */
  tiles: Tile[];
  modules: ModuleRoom[];
  facilities: Record<FacilityKind, Room>;
  points: { hub: Point; bridgeRail: Point };
}

/**
 * Lay out a deck on a tile grid. A corridor (the spine) runs left to right with the lift at its
 * left end; rooms sit in slots above and below it, each joined to it by a door tile.
 * Slot 0 holds quarters/engineering bay, then modules in pairs, then pre-flight console/airlock.
 */
export function layoutDeck(moduleNames: readonly string[]): DeckLayout {
  const ids = [...new Set(moduleNames)].sort().slice(0, MAX_MODULES);
  const slots = 2 + Math.ceil(ids.length / 2);
  const width = FIRST_SLOT_X + SLOT_WIDTH * slots + 1;
  const tiles: Tile[] = Array.from({ length: width * HEIGHT }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return x === 0 || y === 0 || x === width - 1 || y === HEIGHT - 1 ? "edge" : "ground";
  });
  const set = (p: Point, tile: Tile) => {
    tiles[p.y * width + p.x] = tile;
  };

  const placeRoom = (slot: number, top: boolean): Room => {
    const x = FIRST_SLOT_X + SLOT_WIDTH * slot;
    const y = top ? TOP_ROOM_Y : BOTTOM_ROOM_Y;
    for (let dy = 0; dy < ROOM_SIZE; dy++) {
      for (let dx = 0; dx < ROOM_SIZE; dx++) set({ x: x + dx, y: y + dy }, "room");
    }
    const door = { x: x + 1, y: top ? SPINE_Y - 1 : SPINE_Y + 1 };
    set(door, "corridor");
    return { x, y, w: ROOM_SIZE, h: ROOM_SIZE, door };
  };

  const bridgeRail = { x: 1, y: SPINE_Y };
  for (let x = bridgeRail.x; x <= width - 3; x++) set({ x, y: SPINE_Y }, "corridor");
  const hub = { x: Math.floor((FIRST_SLOT_X + width - 3) / 2), y: SPINE_Y };

  const lastSlot = slots - 1;
  const facilities: Record<FacilityKind, Room> = {
    quarters: placeRoom(0, true),
    engineeringBay: placeRoom(0, false),
    preflightConsole: placeRoom(lastSlot, true),
    airlock: placeRoom(lastSlot, false),
  };
  const modules = ids.map((id, i): ModuleRoom => ({
    ...placeRoom(1 + Math.floor(i / 2), i % 2 === 0),
    id,
    variant: variantFor(id),
  }));

  return {
    width,
    height: HEIGHT,
    spineY: SPINE_Y,
    tiles,
    modules,
    facilities,
    points: { hub, bridgeRail },
  };
}

export function tileAt(layout: DeckLayout, { x, y }: Point): Tile {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return "edge";
  return layout.tiles[y * layout.width + x]!;
}

export function isWalkable(layout: DeckLayout, point: Point): boolean {
  const tile = tileAt(layout, point);
  return tile === "ground" || tile === "corridor";
}

/** The tile a crew member stands on for a waypoint. Unknown modules fall back to the hub. */
export function pointFor(layout: DeckLayout, waypoint: Waypoint): Point {
  switch (waypoint.kind) {
    case "module":
      return layout.modules.find((m) => m.id === waypoint.moduleId)?.door ?? layout.points.hub;
    case "hub":
    case "bridgeRail":
      return layout.points[waypoint.kind];
    default:
      return layout.facilities[waypoint.kind].door;
  }
}

const GLYPHS: Record<Tile, string> = { edge: "#", ground: ".", corridor: "=", room: "?" };
const FACILITY_GLYPHS: Record<FacilityKind, string> = {
  quarters: "Q",
  engineeringBay: "E",
  preflightConsole: "P",
  airlock: "X",
};

/** Debug/snapshot view: one character per tile. */
export function renderAscii(layout: DeckLayout): string {
  const grid = Array.from({ length: layout.height }, (_, y) =>
    Array.from({ length: layout.width }, (_, x) => GLYPHS[tileAt(layout, { x, y })]),
  );
  const paint = (room: Room, glyph: string) => {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) grid[room.y + dy]![room.x + dx] = glyph;
    }
  };
  for (const room of layout.modules) paint(room, "A");
  for (const [kind, room] of Object.entries(layout.facilities)) {
    paint(room, FACILITY_GLYPHS[kind as FacilityKind]);
  }
  grid[layout.points.bridgeRail.y]![layout.points.bridgeRail.x] = "L";
  grid[layout.points.hub.y]![layout.points.hub.x] = "H";
  return grid.map((row) => row.join("")).join("\n");
}

/** FNV-1a hash of the name, bucketed into a look variant. */
function variantFor(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % MODULE_VARIANTS;
}
