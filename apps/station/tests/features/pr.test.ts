import { describe, expect, test } from "vite-plus/test";
import { openPullRequest, prBody, prTitle, type Exec } from "../../src/features/pr/pr.server.ts";

const request = {
  cwd: "/tree",
  branch: "spaceship/add-dark-mode-abc123",
  repoPath: "/repo",
  task: "Add dark mode\nwith a toggle in the header",
  name: "Nova",
  console: "Console 4",
};

/** A fake git and gh: answers by the first two words of the command. */
function fake(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const x: Exec = async (command, args, cwd) => {
    calls.push(`${cwd}$ ${command} ${args.join(" ")}`);
    const answer =
      answers[`${command} ${args[0]} ${args[1] ?? ""}`.trim()] ?? answers[`${command} ${args[0]}`];
    if (answer instanceof Error) throw answer;
    return answer ?? "";
  };
  return { x, calls };
}

describe("PR title and body", () => {
  test("the title is the task's first line, or the branch without its id", () => {
    expect(prTitle(request.task, request.branch)).toBe("Add dark mode");
    expect(prTitle("", request.branch)).toBe("add dark mode");
    expect(prTitle("x".repeat(100), request.branch)).toHaveLength(72);
  });

  test("prBody puts the approved brief between the task and the commits", () => {
    const body = prBody({ ...request, brief: "## Brief (approved, rev 2)\n\nB" }, ["Add toggle"]);
    expect(body).toContain("## Brief (approved, rev 2)\n\nB");
    expect(body.indexOf("## Task")).toBeLessThan(body.indexOf("## Brief (approved, rev 2)"));
    expect(body.indexOf("## Brief (approved, rev 2)")).toBeLessThan(body.indexOf("## Commits"));
  });

  test("prBody has no brief section without a brief", () => {
    expect(prBody(request, ["Add toggle"])).not.toContain("## Brief");
  });

  test("prBody puts evidence before the sign-off", () => {
    const body = prBody({ ...request, evidence: "### Pre-flight: GO" }, ["Add toggle"]);
    expect(body.indexOf("### Pre-flight: GO")).toBeGreaterThan(body.indexOf("- Add toggle"));
    expect(body.indexOf("### Pre-flight: GO")).toBeLessThan(body.indexOf("Opened from Spaceship"));
  });

  test("prBody puts the inspection after pre-flight and before the sign-off", () => {
    const body = prBody(
      { ...request, evidence: "### Pre-flight: GO", inspection: "## Inspection: Cleared" },
      ["Add toggle"],
    );
    expect(body.indexOf("## Inspection: Cleared")).toBeGreaterThan(
      body.indexOf("### Pre-flight: GO"),
    );
    expect(body.indexOf("## Inspection: Cleared")).toBeLessThan(
      body.indexOf("Opened from Spaceship"),
    );
    expect(prBody(request, ["x"])).not.toContain("## Inspection");
  });

  test("the body quotes the task and lists the commits", () => {
    const body = prBody(request, ["Add toggle", "Add tests"]);
    expect(body).toContain("> Add dark mode\n> with a toggle in the header");
    expect(body).toContain("- Add toggle\n- Add tests");
    expect(body).toContain("Nova at Console 4");
  });
});

describe("openPullRequest", () => {
  test("pushes the branch and opens a PR into the deck's branch", async () => {
    const { x, calls } = fake({
      "gh pr view": new Error("no pull requests found"),
      "git branch --show-current": "main\n",
      "git log": "Add toggle\n",
      "gh pr create": "Creating pull request…\nhttps://github.com/o/r/pull/7\n",
    });
    expect(await openPullRequest(request, x)).toBe("https://github.com/o/r/pull/7");
    expect(calls).toContain(
      "/tree$ git push -u origin HEAD:refs/heads/spaceship/add-dark-mode-abc123",
    );
    expect(calls.find((c) => c.includes("pr create"))).toContain(
      "--base main --title Add dark mode",
    );
  });

  test("an open PR for the branch is returned as it is", async () => {
    const { x, calls } = fake({ "gh pr view": "https://github.com/o/r/pull/3\n" });
    expect(await openPullRequest(request, x)).toBe("https://github.com/o/r/pull/3");
    expect(calls).toHaveLength(1);
  });

  test("refuses with uncommitted changes, or nothing to merge", async () => {
    await expect(openPullRequest(request, fake({ "git status": " M a.txt\n" }).x)).rejects.toThrow(
      "Commit first",
    );
    await expect(
      openPullRequest(request, fake({ "git branch --show-current": "main\n" }).x),
    ).rejects.toThrow("Nothing on spaceship/add-dark-mode-abc123 that main lacks yet");
  });
});
