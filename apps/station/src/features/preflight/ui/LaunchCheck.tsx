import { Button } from "@cloudflare/kumo";
import { AirplaneTakeOff01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@mothership/protocol";
import { useMutation } from "@tanstack/react-query";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { openCrewPr } from "../../pr/pr.functions";
import { Modal } from "../../world/ui/Modal";
import { useWorld } from "../../world/store";
import { runPreflight } from "../preflight.functions";

/**
 * O without a GO on record: run the pre-flight first, or open the pull request anyway.
 * The station never opens one by itself, and never without this question.
 */
export function LaunchCheck({ member, reason }: { member: CrewInfo; reason: string }) {
  const { close, open, say } = useWorld.getState();
  const run = useMutation({
    mutationFn: () => runPreflight({ data: { crewId: member.id } }),
    onSuccess: close,
  });
  const launch = useMutation({
    mutationFn: () => openCrewPr({ data: { crewId: member.id, force: true } }),
    onSuccess: () => {
      say(`${member.name}'s pull request is open`, "success");
      open({ kind: "pr", crewId: member.id });
    },
  });
  const busy = run.isPending || launch.isPending;
  return (
    <Modal icon={AirplaneTakeOff01Icon} title={`${member.name} · launch check`} subtitle={reason}>
      <ErrorNote error={run.error ?? launch.error} />
      <footer className="modal__foot">
        <Button variant="ghost" disabled={busy} onClick={close}>
          Never mind
        </Button>
        <Button
          variant="secondary"
          disabled={launch.isPending}
          loading={run.isPending}
          icon={<Icon icon={AirplaneTakeOff01Icon} />}
          onClick={() => run.mutate()}
        >
          Run pre-flight
        </Button>
        <Button
          variant="primary"
          disabled={run.isPending}
          loading={launch.isPending}
          icon={<Icon icon={GitPullRequestIcon} />}
          onClick={() => launch.mutate()}
        >
          Launch anyway
        </Button>
      </footer>
    </Modal>
  );
}
