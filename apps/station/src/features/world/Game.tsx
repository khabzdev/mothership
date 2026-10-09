import type { CrewInfo } from "@mothership/protocol";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import { rosterQuery } from "../crew/queries";
import type { Deck } from "../decks/model";
import { CONSOLES } from "./layout";
import { Captain } from "./scene/Captain";
import { Console } from "./scene/Console";
import { CrewMember } from "./scene/CrewMember";
import { Deck as DeckScene } from "./scene/Deck";
import { gameKeysEnabled, useWorld } from "./store";
import { HintBar, TopBar } from "./ui/Hud";
import { Overlays } from "./ui/Overlays";

/** E and P at a console: agent-office's desk keys. */
function useConsoleKeys(crew: CrewInfo[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!gameKeysEnabled(e)) return;
      const { consoleId, open } = useWorld.getState();
      if (consoleId === null) return;
      const member = crew.find((c) => c.consoleId === consoleId);
      if (e.code === "KeyE") {
        e.preventDefault();
        open(
          member
            ? { kind: "terminal", crewId: member.id }
            : { kind: "hire", consoleId, withTask: false },
        );
      } else if (e.code === "KeyP") {
        e.preventDefault();
        open(
          member
            ? { kind: "prompt", crewId: member.id }
            : { kind: "hire", consoleId, withTask: true },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crew]);
}

/** One deck of the Mothership: walk it, hire crew at consoles, watch them work. */
export function Game({ deck }: { deck: Deck }) {
  const { data: crew } = useSuspenseQuery(rosterQuery(deck.id));
  const consoleId = useWorld((s) => s.consoleId);
  useConsoleKeys(crew);

  return (
    <div className="game">
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.1, far: 400, position: [12, 8, 14] }}
        className="game__canvas"
      >
        <color attach="background" args={["#05060c"]} />
        <hemisphereLight args={["#fff5e6", "#2a3550", 1.4]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[-8, 18, 10]}
          intensity={2.2}
          color="#fff1d6"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-bias={-0.0008}
        />
        <Suspense fallback={null}>
          <DeckScene />
          {CONSOLES.map((def) => (
            <Console
              key={def.id}
              def={def}
              crew={crew.find((c) => c.consoleId === def.id)}
              active={def.id === consoleId}
            />
          ))}
          {crew.map((member) => {
            const def = CONSOLES[member.consoleId];
            return def ? <CrewMember key={member.id} crew={member} def={def} /> : null;
          })}
          <Captain />
        </Suspense>
      </Canvas>
      <TopBar deck={deck} crew={crew} />
      <HintBar crew={crew} />
      <Overlays deckId={deck.id} crew={crew} />
    </div>
  );
}
