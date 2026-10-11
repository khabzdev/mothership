import { PROVIDERS, type CrewSignal, type ProviderAdapter } from "@spaceship/providers";
import { crewRegistry, type CrewRegistry } from "./registry.server";

const MAX_BODY_BYTES = 1024 * 1024;

export interface CrewSignalEvent {
  crewId: string;
  missionId: string;
  signal: CrewSignal;
  /** The agent's own session id, when the hook says. */
  sessionId?: string;
}

export interface HookDeps {
  registry: CrewRegistry;
  providers: Record<string, ProviderAdapter>;
  publish: (event: CrewSignalEvent) => void;
}

/** POST /api/hooks: a crew member's CLI hook reporting what it's doing. */
export async function handleHookRequest(request: Request, deps: HookDeps): Promise<Response> {
  const crewId = request.headers.get("x-spaceship-crew") ?? "";
  const crew = deps.registry.verify(crewId, request.headers.get("x-spaceship-token") ?? "");
  if (!crew) return new Response("Unauthorized", { status: 401 });

  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Malformed JSON", { status: 400 });
  }

  const adapter = deps.providers[crew.provider];
  const signal = adapter?.parseHook(payload) ?? null;
  if (signal) {
    const sessionId = adapter?.sessionOf?.(payload);
    try {
      deps.publish({ crewId, missionId: crew.missionId, signal, ...(sessionId && { sessionId }) });
    } catch (error) {
      // The hook already did its job; a broken subscriber must not make Claude retry or stall.
      console.error("Crew signal subscriber failed", error);
    }
  }
  return new Response(null, { status: 204 });
}

type Listener = (event: CrewSignalEvent) => void;
const shared = globalThis as typeof globalThis & { __spaceshipSignals?: Set<Listener> };
const listeners: Set<Listener> = (shared.__spaceshipSignals ??= new Set());

/** Subscribe to crew signals (missions use this to drive the mission engine). */
export function onCrewSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify server-side listeners (the crew service) of a crew signal. */
export function publishCrewSignal(event: CrewSignalEvent): void {
  for (const listener of listeners) listener(event);
}

export const defaultHookDeps: HookDeps = {
  get registry() {
    return crewRegistry();
  },
  providers: PROVIDERS,
  publish: publishCrewSignal,
};
