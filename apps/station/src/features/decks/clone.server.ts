import type { CloneInfo, ServerMsg } from "@mothership/protocol";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Deck } from "./model";

// Cloning a repo into a new deck (agent-office's elevator: "pick one of the repositories your gh
// login can see (or type owner/name) and the office clones it into the workspace folder").

/** A clone that hears nothing for this long is stopped as stalled (ms). */
export const STALL_MS = 3 * 60_000;
/** How often progress goes out to browsers (ms). */
const TICK_MS = 250;

/** Where cloned repos go: `<workspace>/<owner>/<repo>`. */
export function workspaceDir(): string {
  return process.env.MOTHERSHIP_WORKSPACE ?? join(homedir(), "Mothership");
}

export interface CloneTarget {
  /** gh for owner/name, git for a URL. */
  tool: "gh" | "git";
  source: string;
  owner: string;
  name: string;
}

const OWNER_NAME = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

/** What to clone and where it goes: `owner/name` (through gh) or a git URL. */
export function cloneTarget(spec: string): CloneTarget {
  const s = spec.trim();
  const short = OWNER_NAME.exec(s);
  if (short)
    return { tool: "gh", source: `${short[1]}/${short[2]}`, owner: short[1]!, name: short[2]! };
  if (!/^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/.test(s)) {
    throw new Error("Give owner/name, or a git URL (https://, ssh://, git@…, file://)");
  }
  const path = s
    .replace(/^git@[^:]+:/, "/")
    .replace(/^\w+:\/\/[^/]*/, "")
    .replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  const name = basename(parts.at(-1) ?? "", ".git");
  if (!name) throw new Error(`Can't tell the repo's name from ${s}`);
  return { tool: "git", source: s, owner: parts.at(-2) ?? "repos", name };
}

const PHASES: Record<string, string> = {
  "Counting objects": "Counting",
  "Compressing objects": "Compressing",
  "Receiving objects": "Downloading",
  "Resolving deltas": "Unpacking",
  "Updating files": "Checking out",
};

/** One line of git's progress as a readable status: "Downloading 64% · 231.00 MiB · 1.50 MiB/s". */
export function readProgress(line: string): string | null {
  const m =
    /(?:remote: )?([A-Z][a-z]+ [a-z]+):\s+(\d+)%(?:[^,]*,\s*([\d.]+ \w?i?B)(?:\s*\|\s*([\d.]+ \w?i?B\/s))?)?/.exec(
      line,
    );
  const phase = m && PHASES[m[1]!];
  if (!m || !phase) return null;
  return [`${phase} ${m[2]}%`, m[3], m[4]].filter(Boolean).join(" · ");
}

interface Running {
  info: CloneInfo;
  child: ChildProcess | null;
  dest: string;
}

export interface CloneDeps {
  /** Dock the finished checkout as a deck. */
  dock(path: string): Promise<Deck>;
  broadcast(msg: ServerMsg): void;
  /** Where repos are cloned (defaults to the workspace dir). */
  workspace?: string;
}

/** Clones in progress (and the last ones finished or failed), shown on every lift panel. */
export class CloneManager {
  readonly #deps: CloneDeps;
  readonly #clones = new Map<string, Running>();
  #dirty = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: CloneDeps) {
    this.#deps = deps;
  }

  list(): CloneInfo[] {
    return [...this.#clones.values()].map((c) => c.info);
  }

  /** Start cloning `spec`; a checkout already in the workspace is just docked again. */
  start(spec: string): CloneInfo {
    const target = cloneTarget(spec);
    const dest = join(this.#deps.workspace ?? workspaceDir(), target.owner, target.name);
    if ([...this.#clones.values()].some((c) => c.dest === dest && c.info.state === "cloning")) {
      throw new Error(`${target.owner}/${target.name} is already being cloned`);
    }
    const info: CloneInfo = {
      id: crypto.randomUUID(),
      spec: spec.trim(),
      name: target.name,
      state: "cloning",
      progress: "Starting…",
    };
    const running: Running = { info, child: null, dest };
    this.#clones.set(info.id, running);
    this.#changed();

    if (existsSync(join(dest, ".git"))) {
      void this.#finish(running);
      return info;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const args =
      target.tool === "gh"
        ? ["repo", "clone", target.source, dest, "--", "--progress"]
        : ["clone", "--progress", target.source, dest];
    const child = spawn(target.tool, args, {
      env: {
        ...process.env,
        // Never sit waiting on a password or a host key nobody will type.
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
        GH_PROMPT_DISABLED: "1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    running.child = child;
    let last = "";
    let heard = Date.now();
    const stall = setInterval(() => {
      if (Date.now() - heard < STALL_MS) return;
      this.#fail(running, "Stopped: nothing heard from the remote for 3 minutes");
    }, 5000);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      heard = Date.now();
      for (const line of chunk.split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        last = line.trim();
        const progress = readProgress(line);
        if (progress && progress !== info.progress) {
          info.progress = progress;
          this.#changed(false);
        }
      }
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearInterval(stall);
      this.#fail(
        running,
        error.code === "ENOENT"
          ? `${target.tool} isn't installed${target.tool === "gh" ? ": install the GitHub CLI, or give a git URL" : ""}`
          : error.message,
      );
    });
    child.on("close", (code) => {
      clearInterval(stall);
      running.child = null;
      if (info.state !== "cloning") return;
      if (code === 0) void this.#finish(running);
      else
        this.#fail(running, last.replace(/^(fatal|error): /, "") || `Clone failed (exit ${code})`);
    });
    return info;
  }

  /** Stop a clone and throw away what it fetched; or forget a finished or failed one. */
  cancel(id: string): void {
    const running = this.#clones.get(id);
    if (!running) return;
    if (running.info.state === "cloning") {
      running.info.state = "failed";
      running.child?.kill("SIGTERM");
      rmSync(running.dest, { recursive: true, force: true });
    }
    this.#clones.delete(id);
    this.#changed();
  }

  async #finish(running: Running): Promise<void> {
    try {
      const deck = await this.#deps.dock(running.dest);
      Object.assign(running.info, {
        state: "done",
        progress: "Docked",
        deckId: deck.id,
        name: deck.name,
      });
    } catch (error) {
      this.#fail(running, (error as Error).message);
      return;
    }
    this.#changed();
  }

  #fail(running: Running, error: string): void {
    if (running.info.state !== "cloning") return;
    running.child?.kill("SIGTERM");
    if (!existsSync(join(running.dest, ".git", "HEAD"))) {
      rmSync(running.dest, { recursive: true, force: true });
    }
    Object.assign(running.info, { state: "failed", progress: "Failed", error });
    this.#changed();
  }

  /** Progress goes out a few times a second at most; a finish or a failure goes out at once. */
  #changed(urgent = true): void {
    this.#dirty = true;
    if (urgent) this.#flush();
    if (this.list().some((c) => c.state === "cloning")) {
      this.#timer ??= setInterval(() => this.#flush(), TICK_MS);
    }
  }

  #flush(): void {
    if (this.#dirty) {
      this.#dirty = false;
      this.#deps.broadcast({ type: "deck.clones", clones: this.list() });
    }
    if (!this.list().some((c) => c.state === "cloning")) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }
}
