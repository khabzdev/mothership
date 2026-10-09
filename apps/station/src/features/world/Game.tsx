import type { CrewInfo } from "@mothership/protocol";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import { rosterQuery } from "../crew/queries";
import type { Deck } from "../decks/model";
import { CONSOLES } from "./layout";
import { Captain, jumpTo } from "./scene/Captain";
import { Console } from "./scene/Console";
import { CrewMember } from "./scene/CrewMember";
import { Deck as DeckScene } from "./scene/Deck";
import { gameKeysEnabled, useWorld } from "./store";
import { HintBar, TopBar } from "./ui/Hud";
import { NeedsYouBanner, Toast } from "./ui/NeedsYou";
import { Overlays } from "./ui/Overlays";
import { unlockSound } from "./sound";
import { NextUp, waitingInOrder } from "./waiting";

/** Over to a crew member's console, behind it, with any window closed. */
function goToCrew(member: CrewInfo): void {
  useWorld.getState().close();
  jumpTo(member.consoleId);
}

/** N: the next crew member waiting on you (agent-office's features/waiting). */
function useNextUp(crew: CrewInfo[]) {
  const nextUp = useRef(new NextUp());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || !gameKeysEnabled(e)) return;
      e.preventDefault();
      const { consoleId, say } = useWorld.getState();
      const here = crew.find((c) => c.consoleId === consoleId)?.id;
      const member = nextUp.current.next(crew, here);
      if (!member) return say("👍 Nobody is waiting on you");
      goToCrew(member);
      const waiting = waitingInOrder(crew);
      const of =
        waiting.length > 1
          ? ` (${waiting.findIndex((c) => c.id === member.id) + 1} of ${waiting.length})`
          : "";
      say(
        `${member.status === "needs_input" ? `🙋 ${member.name} needs you` : `✅ ${member.name} is done`}${of}. E opens its terminal`,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crew]);
}

/** Browsers only play sound after a gesture: the first key or click opens the audio. */
function useSoundUnlock() {
  useEffect(() => {
    const unlock = () => {
      unlockSound();
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
    return unlock;
  }, []);
}

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
  const toast = useWorld((s) => s.toast);
  useConsoleKeys(crew);
  useNextUp(crew);
  useSoundUnlock();

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
      <NeedsYouBanner
        crew={crew}
        go={(id) => {
          const member = crew.find((c) => c.id === id);
          if (member) goToCrew(member);
        }}
      />
      <Toast toast={toast} />
      <HintBar crew={crew} />
      <Overlays deckId={deck.id} crew={crew} />
    </div>
  );
}
