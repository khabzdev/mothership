import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SMOKE_FILE,
  type SmokeCheck,
  type SmokeCheckState,
  type SmokeFile,
} from "../src/app/smoke";

/** How long one check may take before it is failed. */
export const CHECK_TIMEOUT_MS = 120_000;

const MAX_DETAIL = 200;

export interface Outcome {
  state: SmokeCheckState;
  detail: string;
}

export interface SmokeRunOptions {
  /** $SPACESHIP_HOME: smoke.json and smoke/<id>/ evidence go here. */
  home: string;
  model: string;
  now?: () => number;
  /** Values never written anywhere (the crew's hook tokens), read at write time. */
  secrets?: () => string[];
}

/** Email-shaped text: Claude Code's screen shows the signed-in account's. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Each secret, and anything that looks like an email, replaced with "[redacted]". */
export function redact(text: string, secrets: string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((out, secret) => out.split(secret).join("[redacted]"), text)
    .replace(EMAIL, "[redacted]");
}

/** One line, at most 200 characters. */
function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
}

/** One smoke run's results: each check's outcome, its evidence files, and the final smoke.json. */
export class SmokeRun {
  readonly #options: SmokeRunOptions;
  readonly #ranAt: number;
  readonly #checks = new Map<string, SmokeCheck>();

  constructor(options: SmokeRunOptions) {
    this.#options = options;
    this.#ranAt = (options.now ?? Date.now)();
    // Evidence is replaced each run.
    rmSync(join(options.home, "smoke"), { recursive: true, force: true });
  }

  record(check: SmokeCheck): void {
    this.#checks.set(check.id, { ...check, detail: oneLine(this.#redact(check.detail)) });
  }

  checks(): SmokeCheck[] {
    return [...this.#checks.values()];
  }

  /** Raw evidence for a check: `<home>/smoke/<id>/<name>`, secrets redacted. */
  evidence(id: string, name: string, text: string): void {
    const dir = join(this.#options.home, "smoke", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), this.#redact(text));
  }

  /** Write smoke.json: every expected check without a result counts as failed. */
  finish(versions: { claude: string | null; gh: string | null }, expected: string[]): SmokeFile {
    const checks = expected.map(
      (id) => this.#checks.get(id) ?? { id, state: "failed" as const, detail: "did not finish" },
    );
    for (const check of this.#checks.values()) {
      if (!expected.includes(check.id)) checks.push(check);
    }
    const file: SmokeFile = {
      ranAt: this.#ranAt,
      claudeVersion: versions.claude,
      ghVersion: versions.gh,
      model: this.#options.model,
      checks,
    };
    mkdirSync(this.#options.home, { recursive: true });
    writeFileSync(join(this.#options.home, SMOKE_FILE), `${JSON.stringify(file, null, 2)}\n`);
    return file;
  }

  #redact(text: string): string {
    return redact(text, this.#options.secrets?.() ?? []);
  }
}

/** Run one check and record its outcome; a throw or the timeout fails it, never the run. */
export async function runCheck(
  run: SmokeRun,
  id: string,
  body: () => Promise<Outcome>,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({ state: "failed", detail: `timed out after ${Math.round(timeoutMs / 1000)} s` }),
      timeoutMs,
    );
  });
  let outcome: Outcome;
  try {
    outcome = await Promise.race([body(), timeout]);
  } catch (error) {
    outcome = { state: "failed", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
  run.record({ id, ...outcome });
  return outcome;
}

/** The terminal table: id · state · detail, one row per check. */
export function table(file: SmokeFile): string {
  const width = Math.max(...file.checks.map((c) => c.id.length));
  return file.checks
    .map((c) => `${c.id.padEnd(width)} · ${c.state.padEnd(7)} · ${c.detail}`)
    .join("\n");
}
