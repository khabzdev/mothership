import { PROVIDERS } from "@mothership/providers";
import { BriefService } from "../features/briefs/briefs.server";
import { CrewService } from "../features/crew/service.server";
import { onCrewSignal } from "../features/crew/hooks.server";
import { PtyCrewLauncher } from "../features/crew/launcher.server";
import { crewRegistry } from "../features/crew/registry.server";
import { CloneManager } from "../features/decks/clone.server";
import { dockRepo } from "../features/decks/decks.server";
import { GitHubBoards } from "../features/github/github.server";
import { QueueService } from "../features/queue/queue.server";
import { getDeck } from "../features/decks/decks.server";
import { LabelService } from "../features/labels/labels.server";
import { CheckService } from "../features/preflight/checks.server";
import { PreflightService } from "../features/preflight/preflight.server";
import { ScreenRelay } from "../features/crew/screens.server";
import { TerminalRelay } from "../features/crew/terminals.server";
import { getDb, mothershipHome } from "../shared/db/client.server";
import { hub, type Peer } from "../shared/realtime/hub.server";
import type { Diagnostics } from "./diagnostics";
import { runDiagnostics } from "./diagnostics.server";
import { exec } from "./exec.server";

/** Where crew hooks reach the station. */
export function stationUrl(): string {
  return process.env.MOTHERSHIP_STATION_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
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
  diagnostics: (options?: { refresh?: boolean }) => Promise<Diagnostics>;
}

const DIAGNOSTICS_TTL_MS = 30_000;
const shared = globalThis as typeof globalThis & { __mothershipStation?: Station };

/** The station: crew, PTY host, hooks and browser sockets, wired together once per process. */
export function getStation(): Station {
  shared.__mothershipStation ??= (() => {
    const home = mothershipHome();
    const launcher = new PtyCrewLauncher({
      home,
      registry: crewRegistry,
      providers: PROVIDERS,
      stationUrl: stationUrl(),
    });
    const crew = new CrewService({
      db: getDb(),
      launcher,
      broadcast: (msg) => hub.broadcast(msg),
      home,
    });

    // Pre-flight: the deck's checks run in a crew member's worktree when it stops.
    const checks = new CheckService({ db: getDb(), broadcast: (msg) => hub.broadcast(msg) });
    const preflight = new PreflightService({
      db: getDb(),
      crew,
      checks,
      broadcast: (msg) => hub.broadcast(msg),
      home,
    });
    crew.busyWith((crewId) => preflight.busy(crewId));
    preflight.reconcile();

    // Briefs: the plans Claude submits in plan mode; Y and N answer its approval dialog.
    const briefs = new BriefService({
      db: getDb(),
      crew,
      screens: launcher,
      broadcast: (msg) => hub.broadcast(msg),
      write: (crewId, data) => launcher.write(crewId, data),
    });
    crew.describeWith((crewId) => ({
      preflight: preflight.info(crewId),
      brief: briefs.info(crewId),
    }));
    crew.briefWaitingWith((crewId) => briefs.waiting(crewId));
    crew.briefUnapprovedWith((crewId) => briefs.unapproved(crewId));
    preflight.planningWith((crewId) => briefs.planning(crewId));

    onCrewSignal((event) => crew.handleSignal(event));
    onCrewSignal((event) => preflight.handleSignal(event));
    onCrewSignal((event) => briefs.handleSignal(event));
    launcher.onExit(({ crewId }) => crew.handleExit(crewId));
    launcher.onExit(({ crewId }) => preflight.cancel(crewId));
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
        cached = runDiagnostics({ exec, ptyhost: () => launcher.host() });
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
    // A pull request that merged: the launch klaxon, over the console it came from if we know it.
    const boards = new GitHubBoards();
    boards.onLaunch(({ deckId, pull }) => {
      const from = crew
        .roster(deckId)
        .find((c) => c.prUrl === pull.url || (!!c.branch && c.branch === pull.headRefName));
      hub.broadcast({
        type: "pr.merged",
        deckId,
        number: pull.number,
        title: pull.title,
        ...(from && { crewId: from.id }),
      });
    });
    // The task queue: crew seated for queued tasks as consoles free up (checked every few seconds).
    const queue = new QueueService({
      db: getDb(),
      crew,
      claim: (deckId, n) => boards.claimIssue(getDeck(getDb(), deckId).repoPath, n),
      isSettled: (crewId) => !preflight.busy(crewId),
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
      diagnostics,
    };
  })();
  return shared.__mothershipStation;
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
