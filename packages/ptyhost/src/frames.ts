import type { RawData } from "ws";

/** Decode a ws message (Buffer, ArrayBuffer or fragments) as JSON. */
export function decodeFrame<T>(raw: RawData): T {
  const buffer = Array.isArray(raw)
    ? Buffer.concat(raw)
    : Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw);
  return JSON.parse(buffer.toString("utf8")) as T;
}
