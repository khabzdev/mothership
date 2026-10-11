import { homedir } from "node:os";
import { join } from "node:path";
import { startPtyHost } from "./server.ts";

const home = process.env.SPACESHIP_HOME ?? join(homedir(), ".spaceship");
const host = await startPtyHost({ home });

const shutdown = async () => {
  await host.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
