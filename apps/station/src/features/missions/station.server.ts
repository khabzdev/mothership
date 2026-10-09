import { PROVIDERS } from "@mothership/providers";
import type { Diagnostics } from "../../app/diagnostics";
import { runDiagnostics } from "../../app/diagnostics.server";
import { exec } from "../../app/exec.server";
import { getDb, mothershipHome } from "../../shared/db/client.server";
import { hub, type Peer } from "../../shared/realtime/hub.server";
import { onCrewSignal } from "../crew/hooks.server";
import { PtyCrewLauncher } from "../crew/launcher.server";
import { crewRegistry } from "../crew/registry.server";
import { TerminalRelay } from "../crew/terminals.server";
import { MissionRuntime } from "./runtime.server";

/** Where crew hooks reach the station. */
export function stationUrl(): string {
  return process.env.MOTHERSHIP_STATION_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

interface Station {
  runtime: MissionRuntime;
  launcher: PtyCrewLauncher;
  ready: Promise<void>;
  diagnostics: (options?: { refresh?: boolean }) => Promise<Diagnostics>;
}

const DIAGNOSTICS_TTL_MS = 30_000;

const shared = globalThis as typeof globalThis & { __mothershipStation?: Station };

/** The station's mission runtime, wired to the database, PTY host, hooks and browsers. */
export function getStation(): Station {
  shared.__mothershipStation ??= (() => {
    const home = mothershipHome();
    const launcher = new PtyCrewLauncher({
      home,
      registry: crewRegistry,
      providers: PROVIDERS,
      stationUrl: stationUrl(),
    });
    const runtime = new MissionRuntime({
      db: getDb(),
      launcher,
      broadcast: (msg) => hub.broadcast(msg),
      home,
    });
    onCrewSignal((event) => void runtime.handleSignal(event));
    registerTerminals(new TerminalRelay(launcher, (peer, msg) => hub.send(peer, msg)));
    launcher.onExit(({ crewId, exitCode }) => void runtime.handleCrewExit(crewId, exitCode));
    launcher.onHostLost(() => {
      console.warn("[station] PTY host connection lost; reconnecting");
      void launcher
        .sessions()
        .then((sessions) => runtime.reconcile(sessions))
        .catch((error: unknown) => console.error("Reconcile after PTY host loss failed", error));
    });
    const ready = launcher
      .sessions()
      .then((sessions) => runtime.reconcile(sessions))
      .catch((error: unknown) => console.error("Station startup reconcile failed", error));
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
    return { runtime, launcher, ready, diagnostics };
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
