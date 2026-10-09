import { Stars } from "@react-three/drei";
import { useRef } from "react";
import type { Object3D } from "three";
import { DECK } from "../layout";
import type { DeckPaint } from "../paint";
import { Airlock } from "./Airlock";
import { Furniture } from "./Furniture";
import { KAYKIT_SCALE, useProp } from "./models";
import { Shell } from "./Shell";
import { useSolid } from "./solid";

function Prop({
  name,
  position,
  rotation = 0,
  scale = KAYKIT_SCALE,
  solid = false,
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
  solid?: boolean;
}) {
  const scene = useProp(name);
  const ref = useRef<Object3D>(null);
  useSolid(ref, solid);
  return (
    <primitive
      ref={ref}
      object={scene}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
    />
  );
}

/** The deck: its shell (bulkheads, windows, floor), the airlock, cargo and furniture. */
export function Deck({ paint }: { paint: DeckPaint }) {
  return (
    <group>
      <Stars radius={120} depth={60} count={4000} factor={4} fade speed={0.4} />

      <Shell paint={paint} />

      <Airlock />

      {/* Cargo bay corner (north-east). */}
      <Prop
        name="containers_A"
        position={[DECK.maxX - 2.2, 0, DECK.minZ + 2]}
        rotation={-Math.PI / 2}
        solid
      />
      <Prop name="cargo_A_stacked" position={[DECK.maxX - 2, 0, DECK.minZ + 5]} solid />

      {/* Lounge (south-east), like agent-office's couches by the windows. */}
      <Furniture
        name="rug_rectangle_stripes_A"
        position={[12.5, 0.005, 8.5]}
        scale={[1.6, 1, 1.6]}
      />
      <Furniture name="couch_pillows" position={[12.5, 0, 11.2]} rotation={Math.PI} solid />
      <Furniture name="armchair_pillows" position={[9.4, 0, 8.5]} rotation={Math.PI / 2} solid />
      <Furniture name="armchair" position={[15.6, 0, 8.5]} rotation={-Math.PI / 2} solid />
      <Furniture name="table_low" position={[12.5, 0, 8.5]} solid />
      <Furniture name="lamp_standing" position={[16.4, 0, 11.6]} solid />
      <Furniture name="cactus_medium_A" position={[8.6, 0, 11.6]} solid />

      {/* Library wall (north): shelves, a cabinet and pictures. */}
      <Furniture name="shelf_B_large_decorated" position={[3, 1.5, DECK.minZ + 0.45]} />
      <Furniture name="shelf_B_large_decorated" position={[6.2, 1.5, DECK.minZ + 0.45]} />
      <Furniture name="cabinet_medium_decorated" position={[4.6, 0, DECK.minZ + 0.6]} solid />
      {/* The north wall's west half holds the Mission, Launch and queue boards (scene/Board.tsx). */}

      {/* Plants and lamps around the pods. */}
      <Furniture name="cactus_medium_B" position={[DECK.minX + 1, 0, DECK.minZ + 1]} solid />
      <Furniture name="cactus_small_A" position={[DECK.minX + 1, 0, DECK.maxZ - 1]} solid />
      <Furniture name="cactus_medium_A" position={[1.4, 0, 0]} solid />
      <Furniture name="lamp_standing" position={[-14.5, 0, 0]} solid />
      <Furniture
        name="cabinet_small"
        position={[DECK.minX + 0.6, 0, -6]}
        rotation={Math.PI / 2}
        solid
      />
      <Furniture
        name="cabinet_small"
        position={[DECK.minX + 0.6, 0, 6]}
        rotation={Math.PI / 2}
        solid
      />
      <Prop name="lights" position={[DECK.minX + 4, 0, DECK.minZ + 1]} solid />
    </group>
  );
}
