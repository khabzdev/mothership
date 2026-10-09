import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import { parseCrewIdInput } from "../crew/model";
import { CONSOLES } from "../world/layout";
import { openPullRequest } from "./pr.server";

/** O: push a crew member's branch and open its pull request, or give back the one it has. */
export const openCrewPr = createServerFn({ method: "POST" })
  .validator(parseCrewIdInput)
  .handler(async ({ data }) => {
    const { crew } = getStation();
    const member = crew.member(data.crewId);
    if (member.prUrl) return { url: member.prUrl, opened: false };
    const { cwd, repoPath, ownWorktree } = crew.workdir(data.crewId);
    if (!ownWorktree || !member.branch) {
      throw new Error(
        `${member.name} works in the deck's own checkout: hire it with its own worktree to open a pull request`,
      );
    }
    try {
      const url = await openPullRequest({
        cwd,
        repoPath,
        branch: member.branch,
        task: member.task,
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
