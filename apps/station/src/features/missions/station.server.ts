import { PROVIDERS } from "@mothership/providers";
import type { Diagnostics } from "../../app/diagnostics";
import { runDiagnostics } from "../../app/diagnostics.server";
import { exec } from "../../app/exec.server";
import { getDb, mothershipHome } from "../../shared/db/client.server";
import { hub } from "../../shared/realtime/hub.server";
import { onCrewSignal } from "../crew/hooks.server";
import { PtyCrewLauncher } from "../crew/launcher.server";
import { crewRegistry } from "../crew/registry.server";
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
    launcher.onExit(({ crewId, exitCode }) => void runtime.handleCrewExit(crewId, exitCode));
    const ready = launcher
      .sessions()
      .then((sessions) => runtime.reconcile(sessions))
      .catch((error: unknown) => console.error("Station startup reconcile failed", error));
    let cached: Promise<Diagnostics> | undefined;
    let cachedAt = 0;
    const diagnostics = ({ refresh = false } = {}) => {
      if (refresh || !cached || Date.now() - cachedAt > DIAGNOSTICS_TTL_MS) {
        cachedAt = Date.now();
        cached = runDiagnostics({ exec, ptyhost: async () => void (await launcher.sessions()) });
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
