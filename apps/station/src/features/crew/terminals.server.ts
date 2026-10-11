import type { ServerMsg } from "@spaceship/protocol";
import type { AttachResult } from "@spaceship/ptyhost";
import type { Peer } from "../../shared/realtime/hub.server";

/** Where crew terminals live (the PTY host, via the launcher). */
export interface TerminalSource {
  snapshot(crewId: string): Promise<AttachResult>;
  write(crewId: string, data: string): Promise<void>;
  resize(crewId: string, cols: number, rows: number): Promise<void>;
  onOutput(listener: (event: { crewId: string; data: string; seq: number }) => void): () => void;
  onExit(listener: (event: { crewId: string; exitCode: number }) => void): () => void;
}

interface Viewer {
  peer: Peer;
  /** Waiting for the snapshot: output is buffered. */
  pending: boolean;
  buffer: { data: string; seq: number }[];
  /** Output up to this sequence is already in the snapshot the viewer received. */
  coveredSeq: number;
}

/**
 * Relays crew terminals to browsers: a snapshot first, then live output with no gaps or
 * duplicates (output chunks are lined up with the snapshot by sequence number).
 */
export class TerminalRelay {
  readonly #source: TerminalSource;
  readonly #send: (peer: Peer, msg: ServerMsg) => void;
  readonly #viewers = new Map<string, Map<string, Viewer>>();

  constructor(source: TerminalSource, send: (peer: Peer, msg: ServerMsg) => void) {
    this.#source = source;
    this.#send = send;
    source.onOutput(({ crewId, data, seq }) => {
      for (const viewer of this.#viewers.get(crewId)?.values() ?? []) {
        if (viewer.pending) viewer.buffer.push({ data, seq });
        else if (seq > viewer.coveredSeq)
          this.#send(viewer.peer, { type: "terminal.output", crewId, data });
      }
    });
    source.onExit(({ crewId, exitCode }) => {
      for (const viewer of this.#viewers.get(crewId)?.values() ?? []) {
        this.#send(viewer.peer, { type: "terminal.exit", crewId, code: exitCode });
      }
    });
  }

  async attach(peer: Peer, crewId: string): Promise<void> {
    const viewer: Viewer = { peer, pending: true, buffer: [], coveredSeq: 0 };
    const viewers = this.#viewers.get(crewId) ?? new Map<string, Viewer>();
    viewers.set(peer.id, viewer);
    this.#viewers.set(crewId, viewers);

    let snapshot: AttachResult;
    try {
      snapshot = await this.#source.snapshot(crewId);
    } catch (error) {
      this.#remove(crewId, peer, viewer);
      throw error;
    }
    if (this.#viewers.get(crewId)?.get(peer.id) !== viewer) return; // detached meanwhile

    this.#send(peer, {
      type: "terminal.snapshot",
      crewId,
      data: snapshot.snapshot,
      cols: snapshot.cols,
      rows: snapshot.rows,
    });
    viewer.coveredSeq = snapshot.seq;
    viewer.pending = false;
    for (const { data, seq } of viewer.buffer.splice(0)) {
      if (seq > snapshot.seq) this.#send(peer, { type: "terminal.output", crewId, data });
    }
    if (snapshot.exited) this.#send(peer, { type: "terminal.exit", crewId, code: null });
  }

  detach(peer: Peer, crewId: string): void {
    const viewer = this.#viewers.get(crewId)?.get(peer.id);
    if (viewer) this.#remove(crewId, peer, viewer);
  }

  closePeer(peer: Peer): void {
    for (const [crewId, viewers] of this.#viewers) {
      const viewer = viewers.get(peer.id);
      if (viewer) this.#remove(crewId, peer, viewer);
    }
  }

  async input(peer: Peer, crewId: string, data: string): Promise<void> {
    this.#requireViewer(peer, crewId);
    await this.#source.write(crewId, data);
  }

  async resize(peer: Peer, crewId: string, cols: number, rows: number): Promise<void> {
    this.#requireViewer(peer, crewId);
    await this.#source.resize(crewId, cols, rows);
  }

  #requireViewer(peer: Peer, crewId: string): void {
    if (!this.#viewers.get(crewId)?.has(peer.id)) throw new Error(`Attach to ${crewId} first`);
  }

  #remove(crewId: string, peer: Peer, viewer: Viewer): void {
    const viewers = this.#viewers.get(crewId);
    if (viewers?.get(peer.id) !== viewer) return;
    viewers.delete(peer.id);
    if (viewers.size === 0) this.#viewers.delete(crewId);
  }
}
