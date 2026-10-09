import { defineWebSocketHandler } from "nitro";
import { hub, isSameOrigin, type Peer } from "./hub.server";

const peers = new WeakMap<object, Peer>();

const asPeer = (raw: { id: string; send: (data: string) => unknown }): Peer => {
  let peer = peers.get(raw);
  if (!peer) {
    peer = { id: raw.id, send: (text) => void raw.send(text) };
    peers.set(raw, peer);
  }
  return peer;
};

/** Station socket at /_ws (registered in vite.config.ts). */
export default defineWebSocketHandler({
  upgrade(request) {
    if (!isSameOrigin(request)) throw new Response("Forbidden", { status: 403 });
  },
  open: (peer) => hub.open(asPeer(peer)),
  message: (peer, message) => hub.message(asPeer(peer), message.text()),
  close: (peer) => hub.close(asPeer(peer)),
});
