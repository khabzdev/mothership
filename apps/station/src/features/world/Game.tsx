import type { CrewInfo } from "@mothership/protocol";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rosterQuery } from "../crew/queries";
import { launchCards, missionCards } from "../github/cards";
import { boardQuery } from "../github/queries";
import { labelsQuery } from "../labels/queries";
import { Palette } from "../palette/Palette";
import { queueCards } from "../queue/cards";
import { queueQuery } from "../queue/queries";
import type { Deck } from "../decks/model";
import { Toasty } from "@cloudflare/kumo";
import { toasts } from "../../shared/ui/toasts";
import { useConsoleKeys } from "./console-keys";
import { CONSOLES, partnerOf } from "./layout";
import { paintFor } from "./paint";
import { Captain, jumpTo } from "./scene/Captain";
import { Console } from "./scene/Console";
import { CrewMember } from "./scene/CrewMember";
import { Deck as DeckScene } from "./scene/Deck";
import { Departures } from "./scene/Departures";
import { Board } from "./scene/Board";
import { LaunchShow } from "./scene/LaunchShow";
import { LiftDoors } from "./scene/LiftDoors";
import { Sign } from "./scene/Sign";
import { gameKeysEnabled, useWorld } from "./store";
import { HintBar, TopBar } from "./ui/Hud";
import { Boarding } from "./ui/Boarding";
import { CrewPanel } from "./ui/CrewPanel";
import { NeedsYouBanner, useCloneNews, useLaunchNews, useOtherDecksHeadsUp } from "./ui/NeedsYou";
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

/** The boarding screen over the deck until its models have loaded, then a fade out. */
function DeckLoader({ deck, loaded }: { deck: string; loaded: boolean }) {
  const { progress } = useProgress();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div
      className="deck-loader"
      data-loaded={loaded || undefined}
      onAnimationEnd={() => loaded && setGone(true)}
    >
      <Boarding deck={deck} progress={loaded ? 100 : progress} />
    </div>
  );
}

/** Mounts once everything before it in the scene's Suspense has loaded. */
function Ready({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

/** One deck of the Mothership: walk it, hire crew at consoles, watch them work. */
export function Game({ deck }: { deck: Deck }) {
  const { data: crew } = useSuspenseQuery(rosterQuery(deck.id));
  const { data: labels } = useSuspenseQuery(labelsQuery(deck.id));
  const paint = useMemo(() => paintFor(deck.repoPath), [deck.repoPath]);
  const { data: github } = useQuery(boardQuery(deck.id));
  const carried = useWorld((s) => s.carrying?.number);
  const mission = useMemo(() => missionCards(github, carried), [github, carried]);
  const launch = useMemo(() => launchCards(github), [github]);
  const { data: queue } = useQuery(queueQuery(deck.id));
  const queued = useMemo(() => queueCards(queue?.tasks, queue?.limit ?? 3), [queue]);
  const consoleId = useWorld((s) => s.consoleId);
  const [loaded, setLoaded] = useState(false);
  const ready = useCallback(() => setLoaded(true), []);
  useConsoleKeys(deck.id, crew);
  useNextUp(crew);
  useSoundUnlock();
  useOtherDecksHeadsUp(deck.id);
  useCloneNews();
  useLaunchNews(deck.id);

  return (
    <Toasty toastManager={toasts}>
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
            <DeckScene paint={paint} />
            <LiftDoors deckName={deck.name} paint={paint} />
            <Board board="mission" trim={paint.trim} {...mission} />
            <Board board="launch" trim={paint.trim} {...launch} />
            <Board board="queue" trim={paint.trim} {...queued} />
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
            {labels.map((label) => {
              const def = CONSOLES[label.consoleId];
              if (!def) return null;
              const partner = partnerOf(def);
              const twoSided = !partner || !labels.some((l) => l.consoleId === partner.id);
              return <Sign key={label.consoleId} def={def} label={label} twoSided={twoSided} />;
            })}
            <Departures deckId={deck.id} crew={crew} />
            <LaunchShow crew={crew} />
            <Captain />
            <Ready onReady={ready} />
          </Suspense>
        </Canvas>
        <DeckLoader deck={deck.name} loaded={loaded} />
        <TopBar deck={deck} crew={crew} />
        <NeedsYouBanner
          crew={crew}
          go={(id) => {
            const member = crew.find((c) => c.id === id);
            if (member) goToCrew(member);
          }}
        />
        <CrewPanel
          crew={crew}
          open={(member) => {
            goToCrew(member);
            useWorld.getState().open({ kind: "terminal", crewId: member.id });
          }}
        />
        <HintBar crew={crew} labels={labels} />
        <Overlays deckId={deck.id} crew={crew} labels={labels} />
        <Palette deckId={deck.id} crew={crew} labels={labels} />
      </div>
    </Toasty>
  );
}
