import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parsePrInput } from "../crew/model";
import { prBrief } from "../briefs/model";
import { launchGuard } from "../preflight/guard";
import { fingerprint } from "../preflight/fingerprint.server";
import { prEvidence } from "../preflight/report";
import { CONSOLES } from "../world/layout";
import { openPullRequest } from "./pr.server";

export type OpenPrResult = { url: string; opened: boolean } | { needsConfirm: string };

/** O: push a crew member's branch and open its pull request, or give back the one it has. */
export const openCrewPr = createServerFn({ method: "POST" })
  .validator(parsePrInput)
  .handler(async ({ data }): Promise<OpenPrResult> => {
    const { crew, preflight, checks, briefs } = getStation();
    const member = crew.member(data.crewId);
    if (member.prUrl) return { url: member.prUrl, opened: false };
    const { cwd, repoPath, ownWorktree } = crew.workdir(data.crewId);
    if (!ownWorktree || !member.branch) {
      throw new Error(
        `${member.name} works in the deck's own checkout: hire it with its own worktree to open a pull request`,
      );
    }
    const latest = preflight.latest(data.crewId);
    const approved = briefs.approved(data.crewId);
    try {
      // What the worktree holds now: O's guard asks about it, and stale evidence says so.
      let current: { hash: string } | undefined;
      if (data.force) {
        // Launching anyway, a worktree we can't read just leaves the evidence unmarked.
        current = await fingerprint(cwd).catch(() => undefined);
      } else {
        current = await fingerprint(cwd);
        const reason = launchGuard(latest, current, checks.armed(member.deckId) === true);
        if (reason) return { needsConfirm: reason };
      }
      const url = await openPullRequest({
        cwd,
        repoPath,
        branch: member.branch,
        task: member.task,
        brief: approved ? prBrief(approved) : undefined,
        evidence:
          latest && latest.state !== "running" && latest.state !== "cancelled"
            ? prEvidence(latest, current)
            : undefined,
        name: member.name,
        console: CONSOLES[member.consoleId]?.label ?? `Console ${member.consoleId + 1}`,
      });
      crew.setPr(data.crewId, url);
      return { url, opened: true };
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === "ENOENT") throw new Error("Install the GitHub CLI (gh) and run gh auth login");
      throw new Error(e.stderr?.trim().split("\n").at(-1) || e.message);
    }
  });
