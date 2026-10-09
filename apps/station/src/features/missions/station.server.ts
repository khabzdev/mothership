import { PROVIDERS } from "@mothership/providers";
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
}

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
    return { runtime, launcher, ready };
  })();
  return shared.__mothershipStation;
}
