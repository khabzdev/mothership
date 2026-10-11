import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { spaceshipHome } from "../../shared/home.server";
import { plainLines } from "../search/model";

const MAX_BYTES = 256 * 1024;

/** The last 256 KB of a check's full log, as plain text. */
export async function readCheckLog(preflightId: string, checkId: string): Promise<string> {
  const path = join(spaceshipHome(), "preflight", preflightId, `${checkId}.log`);
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    throw new Error("That log is gone");
  }
  try {
    const { size } = await stat(path);
    const length = Math.min(size, MAX_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return plainLines(buffer.toString("utf8")).join("\n");
  } finally {
    await handle.close();
  }
}
