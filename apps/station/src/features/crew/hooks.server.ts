import type { CrewStatus } from "@mothership/protocol";
import { PROVIDERS, type CrewSignal, type ProviderAdapter } from "@mothership/providers";
import { hub } from "../../shared/realtime/hub.server";
import { crewRegistry, type CrewRegistry } from "./registry.server";

const MAX_BODY_BYTES = 1024 * 1024;

export interface CrewSignalEvent {
  crewId: string;
  missionId: string;
  signal: CrewSignal;
}

export interface HookDeps {
  registry: CrewRegistry;
  providers: Record<string, ProviderAdapter>;
  publish: (event: CrewSignalEvent) => void;
}

const STATUS_FOR_SIGNAL = {
  idle: "idle",
  working: "working",
  needsInput: "redAlert",
  stopped: "done",
  ended: "offline",
} as const satisfies Record<CrewSignal["type"], CrewStatus>;

export function statusForSignal(signal: CrewSignal): CrewStatus {
  return STATUS_FOR_SIGNAL[signal.type];
}

/** POST /api/hooks: a crew member's CLI hook reporting what it's doing. */
export async function handleHookRequest(request: Request, deps: HookDeps): Promise<Response> {
  const crewId = request.headers.get("x-mothership-crew") ?? "";
  const crew = deps.registry.verify(crewId, request.headers.get("x-mothership-token") ?? "");
  if (!crew) return new Response("Unauthorized", { status: 401 });

  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Malformed JSON", { status: 400 });
  }

  const signal = deps.providers[crew.provider]?.parseHook(payload) ?? null;
  if (signal) {
    try {
      deps.publish({ crewId, missionId: crew.missionId, signal });
    } catch (error) {
      // The hook already did its job; a broken subscriber must not make Claude retry or stall.
      console.error("Crew signal subscriber failed", error);
    }
  }
  return new Response(null, { status: 204 });
}

type Listener = (event: CrewSignalEvent) => void;
const shared = globalThis as typeof globalThis & { __mothershipSignals?: Set<Listener> };
const listeners: Set<Listener> = (shared.__mothershipSignals ??= new Set());

/** Subscribe to crew signals (missions use this to drive the mission engine). */
export function onCrewSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Broadcast crew status to browsers and notify server-side listeners. */
export function publishCrewSignal(event: CrewSignalEvent): void {
  const { signal } = event;
  hub.broadcast({
    type: "crew.status",
    crewId: event.crewId,
    missionId: event.missionId,
    status: statusForSignal(signal),
    ...(signal.type === "working" && signal.activity && { activity: signal.activity }),
  });
  for (const listener of listeners) listener(event);
}

export const defaultHookDeps: HookDeps = {
  registry: crewRegistry,
  providers: PROVIDERS,
  publish: publishCrewSignal,
};
