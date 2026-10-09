// Client-side API: safe to import from the station (no native or CommonJS dependencies).
export { PtyHostClient } from "./client.ts";
export { ensurePtyHost, type EnsureOptions } from "./ensure.ts";
export type * from "./protocol.ts";
export { readHostState, stateFile, type HostState } from "./state.ts";
