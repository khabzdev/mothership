import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS } from "@spaceship/providers";
import { BriefService } from "../features/briefs/briefs.server";
import { CrewService } from "../features/crew/service.server";
import { DebriefService } from "../features/debrief/debrief.server";
import { onCrewSignal } from "../features/crew/hooks.server";
import { PtyCrewLauncher } from "../features/crew/launcher.server";
import { crewRegistry } from "../features/crew/registry.server";
import { CloneManager } from "../features/decks/clone.server";
import { dockRepo } from "../features/decks/decks.server";
import { announceLaunch, GitHubBoards } from "../features/github/github.server";
import { InspectionService } from "../features/inspection/inspection.server";
import { ReviewSlot } from "../features/inspection/slot.server";
import { QueueService } from "../features/queue/queue.server";
import { MissionLog } from "../features/log/log.server";
import { RankService } from "../features/ranks/ranks.server";
import { getDeck } from "../features/decks/decks.server";
import { LabelService } from "../features/labels/labels.server";
import { CheckService } from "../features/preflight/checks.server";
import { PreflightService } from "../features/preflight/preflight.server";
import { ScreenRelay } from "../features/crew/screens.server";
import { TerminalRelay } from "../features/crew/terminals.server";
import { getDb } from "../shared/db/client.server";
import { openHome, spaceshipHome } from "../shared/home.server";
import { hub, type Peer } from "../shared/realtime/hub.server";
import type { Diagnostics } from "./diagnostics";
import { runDiagnostics } from "./diagnostics.server";
import { exec } from "./exec.server";
import { SMOKE_FILE } from "./smoke";

/** Where crew hooks reach the station. */
export function stationUrl(): string {
  return process.env.SPACESHIP_STATION_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

interface Station {
  crew: CrewService;
  launcher: PtyCrewLauncher;
  labels: LabelService;
  clones: CloneManager;
  boards: GitHubBoards;
  queue: QueueService;
  checks: CheckService;
  preflight: PreflightService;
  briefs: BriefService;
  inspections: InspectionService;
  ranks: RankService;
  debrief: DebriefService;
  log: MissionLog;
  diagnostics: (options?: { refresh?: boolean }) => Promise<Diagnostics>;
}

const DIAGNOSTICS_TTL_MS = 30_000;
const shared = globalThis as typeof globalThis & { __spaceshipStation?: Station };

/** The station: crew, PTY host, hooks and browser sockets, wired together once per process. */
export function getStation(): Station {
  shared.__spaceshipStation ??= (() => {
    const home = openHome();
    const launcher = new PtyCrewLauncher({
      home,
      registry: crewRegistry(),
      providers: PROVIDERS,
      stationUrl: stationUrl(),
    });
    const crew = new CrewService({
      db: getDb(),
      launcher,
      broadcast: (msg) => hub.broadcast(msg),
      home,
    });

    // Pre-flight: the deck's checks run in a crew member's worktree when it stops. The deck's
    // message carries its pending lessons, counted once the debrief exists.
    let debrief: DebriefService | undefined;
    const checks = new CheckService({
      db: getDb(),
      broadcast: (msg) => hub.broadcast(msg),
      pendingCount: (deckId) => debrief?.pendingCount(deckId) ?? 0,
    });
    const preflight = new PreflightService({
      db: getDb(),
      crew,
      checks,
      broadcast: (msg) => hub.broadcast(msg),
      home,
    });
    preflight.reconcile();

    // Ranks: each call sign's service record on a deck, counted as its missions end.
    const ranks = new RankService({ db: getDb(), broadcast: (msg) => hub.broadcast(msg), crew });
    crew.onMissionEnd((end) => ranks.onMissionEnd(end));

    // One `claude -p` review at a time, station-wide: the Inspector and the debrief take turns.
    const slot = new ReviewSlot();
    // The debrief: a mission that hit trouble drafts lessons for you to keep or drop.
    debrief = new DebriefService({
      db: getDb(),
      ranks,
      checks,
      providers: PROVIDERS,
      slot,
      broadcast: (msg) => hub.broadcast(msg),
    });
    const debriefs = debrief;
    crew.onMissionEnd((end) => debriefs.onMissionEnd(end));
    // The captain's log: each ended mission with its evidence, after ranks and the debrief.
    // It snapshots the deck's gates at each mission's end: checks armed with some on, Inspector on.
    const log = new MissionLog({
      db: getDb(),
      broadcast: (msg) => hub.broadcast(msg),
      gates: (deckId) => ({
        checks: checks.armed(deckId) === true && checks.enabled(deckId).length > 0,
        inspector: inspections.enabled(deckId),
      }),
    });
    crew.onMissionEnd((end) => log.onMissionEnd(end));

    // Briefs: the plans Claude submits in plan mode; Y and N answer its approval dialog.
    const briefs = new BriefService({
      db: getDb(),
      crew,
      screens: launcher,
      broadcast: (msg) => hub.broadcast(msg),
      write: (crewId, data) => launcher.write(crewId, data),
      cleanBrief: (crewId) => ranks.cleanBrief(crewId),
    });
    // The Inspector: every stop that passes pre-flight gets a scope check and a read-only review.
    const inspections = new InspectionService({
      db: getDb(),
      crew,
      checks,
      briefs,
      preflight,
      providers: PROVIDERS,
      broadcast: (msg) => hub.broadcast(msg),
      slot,
    });
    preflight.onGo((crewId, print) => inspections.afterGo(crewId, print));
    inspections.reconcile();
    crew.busyWith((crewId) => preflight.busy(crewId) || inspections.busy(crewId));
    crew.describeWith((crewId) => ({
      preflight: preflight.info(crewId),
      brief: briefs.info(crewId),
      inspection: inspections.info(crewId),
      ...ranks.info(crewId),
    }));
    crew.briefWaitingWith((crewId) => briefs.waiting(crewId));
    crew.briefUnapprovedWith((crewId) => briefs.unapproved(crewId));
    crew.lessonsWith((deckId) => debriefs.kept(deckId));
    preflight.planningWith((crewId) => briefs.planning(crewId));

    onCrewSignal((event) => crew.handleSignal(event));
    onCrewSignal((event) => preflight.handleSignal(event));
    onCrewSignal((event) => briefs.handleSignal(event));
    onCrewSignal((event) => inspections.handleSignal(event));
    launcher.onExit(({ crewId }) => crew.handleExit(crewId));
    launcher.onExit(({ crewId }) => preflight.cancel(crewId));
    launcher.onExit(({ crewId }) => inspections.cancel(crewId));
    const screens = new ScreenRelay(launcher, (msg) => hub.broadcast(msg));
    screens.start();
    crew.onGone((crewId) => screens.forget(crewId));
    hub.onPeerOpen((peer) => {
      for (const msg of screens.current()) hub.send(peer, msg);
    });
    const reconcile = () =>
      launcher
        .sessions()
        .then((sessions) => {
          screens.touch(sessions.map((s) => s.id));
          return crew.reconcile(sessions);
        })
        .catch((error: unknown) => console.error("[station] reconcile failed", error));
    launcher.onHostLost(() => {
      console.warn("[station] PTY host connection lost; reconnecting");
      // A brief whose dialog didn't survive the reconnect waits for nothing: superseded.
      void reconcile()
        .then(() => briefs.reconcile())
        .catch((error: unknown) => console.error("[station] brief reconcile failed", error));
    });
    // Briefs left waiting by a station that stopped are checked once the sessions are known.
    void reconcile()
      .then(() => briefs.reconcile())
      .catch((error: unknown) => console.error("[station] brief reconcile failed", error));
    registerTerminals(new TerminalRelay(launcher, (peer, msg) => hub.send(peer, msg)));

    let cached: Promise<Diagnostics> | undefined;
    let cachedAt = 0;
    const diagnostics = ({ refresh = false } = {}) => {
      if (refresh || !cached || Date.now() - cachedAt > DIAGNOSTICS_TTL_MS) {
        cachedAt = Date.now();
        cached = runDiagnostics({
          exec,
          ptyhost: () => launcher.host(),
          readSmoke: () => {
            try {
              return readFileSync(join(spaceshipHome(), SMOKE_FILE), "utf8");
            } catch {
              return null;
            }
          },
        });
      }
      return cached;
    };
    void diagnostics().then((d) => {
      for (const check of d.checks.filter((c) => c.status !== "ok")) {
        console.warn(
          `[station] ${check.label}: ${check.detail ?? check.status}${check.fix ? ` (${check.fix})` : ""}`,
        );
      }
    });
    const labels = new LabelService(getDb(), (msg) => hub.broadcast(msg));
    const clones = new CloneManager({
      dock: (path) => dockRepo(getDb(), path),
      broadcast: (msg) => hub.broadcast(msg),
    });
    hub.onPeerOpen((peer) => {
      const list = clones.list();
      if (list.length) hub.send(peer, { type: "deck.clones", clones: list });
    });
    // A pull request that merged: credited to the call sign; the launch klaxon when it's recent.
    const boards = new GitHubBoards(undefined, {
      unmerged: (d, now) => ranks.unmerged(d, now),
      closed: (d, url) => ranks.onClosed(d, url),
    });
    boards.onLaunch(
      announceLaunch({
        roster: (deckId) => crew.roster(deckId),
        broadcast: (msg) => hub.broadcast(msg),
        onMerged: (deckId, pull) => ranks.onMerged(deckId, pull),
      }),
    );
    // The task queue: crew seated for queued tasks as consoles free up (checked every few seconds).
    const queue = new QueueService({
      db: getDb(),
      crew,
      claim: (deckId, n) => boards.claimIssue(getDeck(getDb(), deckId).repoPath, n),
      isSettled: (crewId) => !preflight.busy(crewId) && !inspections.busy(crewId),
    });
    setInterval(() => void queue.tickAll(), 4000);
    return {
      crew,
      launcher,
      labels,
      clones,
      boards,
      queue,
      checks,
      preflight,
      briefs,
      inspections,
      ranks,
      debrief: debriefs,
      log,
      diagnostics,
    };
  })();
  return shared.__spaceshipStation;
}

/** Browser terminal traffic over the station socket. */
function registerTerminals(relay: TerminalRelay): void {
  const report = (peer: Peer) => (error: unknown) =>
    hub.send(peer, { type: "error", message: (error as Error).message });
  hub.on("terminal.attach", (msg, peer) => void relay.attach(peer, msg.crewId).catch(report(peer)));
  hub.on("terminal.detach", (msg, peer) => relay.detach(peer, msg.crewId));
  hub.on(
    "terminal.input",
    (msg, peer) => void relay.input(peer, msg.crewId, msg.data).catch(report(peer)),
  );
  hub.on(
    "terminal.resize",
    (msg, peer) => void relay.resize(peer, msg.crewId, msg.cols, msg.rows).catch(report(peer)),
  );
  hub.onPeerClose((peer) => relay.closePeer(peer));
}
