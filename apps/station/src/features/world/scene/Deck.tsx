import { Stars } from "@react-three/drei";
import { DECK } from "../layout";
import { Airlock } from "./Airlock";
import { Furniture } from "./Furniture";
import { Island } from "./Island";
import { Outpost } from "./Outpost";

/** The deck: its terrain island, the airlock, cargo and furniture. */
export function Deck() {
  return (
    <group>
      <Stars radius={120} depth={60} count={4000} factor={4} fade speed={0.4} />

      <Island />
      <Outpost />

      <Airlock />

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
    </group>
  );
}
