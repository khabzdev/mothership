import { PROVIDERS } from "@mothership/providers";
import { CrewService } from "../features/crew/service.server";
import { onCrewSignal } from "../features/crew/hooks.server";
import { PtyCrewLauncher } from "../features/crew/launcher.server";
import { crewRegistry } from "../features/crew/registry.server";
import { LabelService } from "../features/labels/labels.server";
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

    onCrewSignal((event) => crew.handleSignal(event));
    launcher.onExit(({ crewId }) => crew.handleExit(crewId));
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
      void reconcile();
    });
    void reconcile();
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
    return { crew, launcher, labels, diagnostics };
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
