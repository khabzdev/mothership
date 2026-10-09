import type { Check, Diagnostics } from "./diagnostics";
import type { Exec, ExecResult } from "./exec.server";

export interface DiagnosticsDeps {
  exec: Exec;
  /** Resolves once the PTY host is reachable. */
  ptyhost: () => Promise<void>;
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

async function checkClaude({ exec }: DiagnosticsDeps): Promise<Check> {
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
      fix: FIX.claudeLogin,
    };
  }
  // Only the method: never surface email or organisation.
  const method = typeof status.authMethod === "string" ? status.authMethod : "unknown";
  return { id: "claude", label, status: "ok", detail: `${versionText} · signed in via ${method}` };
}

async function checkGh({ exec }: DiagnosticsDeps): Promise<Check> {
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
    await ptyhost();
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

/** Check the tools crew and the airlock depend on. Never throws. */
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
    airlockReady: ok(git) && ok(gh),
    checkedAt: Date.now(),
  };
}
