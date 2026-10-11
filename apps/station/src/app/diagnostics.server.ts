import type { Check, Diagnostics } from "./diagnostics";
import type { Exec, ExecResult } from "./exec.server";
import { NO_SMOKE, parseSmokeFile, smokeStatus } from "./smoke";

export interface DiagnosticsDeps {
  exec: Exec;
  /** Resolves once the PTY host is reachable, saying whether it's an outdated one kept for running crew. */
  ptyhost: () => Promise<{ outdated?: boolean; liveSessions?: number }>;
  /** The text of $SPACESHIP_HOME/smoke.json, or null when there is none. */
  readSmoke?: () => string | null;
}

const FIX = {
  git: "Install git: https://git-scm.com/downloads",
  claudeInstall: "Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash",
  claudeLogin: "Run: claude auth login",
  ghInstall: "Install the GitHub CLI: brew install gh",
  ghLogin: "Run: gh auth login",
  ptyhost: "Build the PTY host: vp run -r build",
};

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

/** A failed run (missing binary or timeout) as a check, or null if the command ran. */
function failure(
  id: Check["id"],
  label: string,
  cmd: string,
  result: ExecResult,
  install: string,
): Check | null {
  if (result.missing)
    return { id, label, status: "missing", detail: `${cmd.split(" ")[0]} not found`, fix: install };
  if (result.timedOut) return { id, label, status: "error", detail: `${cmd} timed out` };
  return null;
}

async function checkGit({ exec }: DiagnosticsDeps): Promise<Check> {
  const result = await exec("git", ["--version"]);
  return (
    failure("git", "Git", "git --version", result, FIX.git) ??
    (result.code === 0
      ? { id: "git", label: "Git", status: "ok", detail: firstLine(result.stdout) }
      : {
          id: "git",
          label: "Git",
          status: "error",
          detail: firstLine(result.stderr),
          fix: FIX.git,
        })
  );
}

/** The installed Claude Code: its version (as "2.1.104") and whether it's signed in. */
export async function checkClaude({ exec }: Pick<DiagnosticsDeps, "exec">): Promise<Check> {
  const label = "Claude Code";
  const version = await exec("claude", ["--version"]);
  const failed = failure("claude", label, "claude --version", version, FIX.claudeInstall);
  if (failed) return failed;

  const auth = await exec("claude", ["auth", "status", "--json"]);
  const authFailed = failure("claude", label, "claude auth status", auth, FIX.claudeInstall);
  if (authFailed) return authFailed;

  let status: { loggedIn?: unknown; authMethod?: unknown } = {};
  try {
    status = JSON.parse(auth.stdout) as typeof status;
  } catch {
    // Unreadable output: treat as signed out.
  }
  const versionText = firstLine(version.stdout).replace(/\s*\(Claude Code\)$/, "");
  if (auth.code !== 0 || status.loggedIn !== true) {
    return {
      id: "claude",
      label,
      status: "unauthenticated",
      detail: `${versionText} · not signed in`,
      version: versionText,
      fix: FIX.claudeLogin,
    };
  }
  // Only the method: never surface email or organisation.
  const method = typeof status.authMethod === "string" ? status.authMethod : "unknown";
  return {
    id: "claude",
    label,
    status: "ok",
    detail: `${versionText} · signed in via ${method}`,
    version: versionText,
  };
}

/** The installed GitHub CLI: its version line and whether it is signed in. */
export async function checkGh({ exec }: Pick<DiagnosticsDeps, "exec">): Promise<Check> {
  const label = "GitHub CLI";
  const version = await exec("gh", ["--version"]);
  const failed = failure("gh", label, "gh --version", version, FIX.ghInstall);
  if (failed) return failed;
  const auth = await exec("gh", ["auth", "status"]);
  const authFailed = failure("gh", label, "gh auth status", auth, FIX.ghInstall);
  if (authFailed) return authFailed;
  const detail = firstLine(version.stdout);
  return auth.code === 0
    ? { id: "gh", label, status: "ok", detail }
    : {
        id: "gh",
        label,
        status: "unauthenticated",
        detail: `${detail} · not signed in`,
        fix: FIX.ghLogin,
      };
}

async function checkPtyhost({ ptyhost }: DiagnosticsDeps): Promise<Check> {
  try {
    const host = await ptyhost();
    if (host.outdated) {
      return {
        id: "ptyhost",
        label: "PTY host",
        status: "error",
        detail: `Outdated PTY host is still running ${host.liveSessions ?? "some"} crew`,
        fix: "Let those crew finish (or stop them), then re-check to upgrade the PTY host",
      };
    }
    return { id: "ptyhost", label: "PTY host", status: "ok", detail: "reachable" };
  } catch (error) {
    return {
      id: "ptyhost",
      label: "PTY host",
      status: "error",
      detail: (error as Error).message,
      fix: FIX.ptyhost,
    };
  }
}

/** The last smoke run against the installed claude. Never throws: anything unreadable is "no run". */
function checkSmoke({ readSmoke }: DiagnosticsDeps, claude: Check) {
  try {
    const text = readSmoke?.();
    const file = text ? parseSmokeFile(text) : null;
    return smokeStatus(file, claude.version || null, Date.now());
  } catch {
    return NO_SMOKE;
  }
}

/** Check the tools crew and launches depend on. Never throws. */
export async function runDiagnostics(deps: DiagnosticsDeps): Promise<Diagnostics> {
  const [git, claude, ptyhost, gh] = await Promise.all([
    checkGit(deps),
    checkClaude(deps),
    checkPtyhost(deps),
    checkGh(deps),
  ]);
  const ok = (c: Check) => c.status === "ok";
  return {
    checks: [git, claude, ptyhost, gh],
    crewReady: ok(git) && ok(claude) && ok(ptyhost),
    launchReady: ok(git) && ok(gh),
    smoke: checkSmoke(deps, claude),
    checkedAt: Date.now(),
  };
}
