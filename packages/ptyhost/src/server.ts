// Host-side API: pulls in node-pty and xterm. Only the host process and tests use this.
export { startPtyHost, type PtyHost, type StartOptions } from "./host.ts";
