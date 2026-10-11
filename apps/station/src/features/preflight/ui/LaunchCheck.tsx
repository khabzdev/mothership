import { Button } from "@cloudflare/kumo";
import { AirplaneTakeOff01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@spaceship/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reinspectMutation } from "../../inspection/queries";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { openCrewPr } from "../../pr/pr.functions";
import { Modal } from "../../world/ui/Modal";
import { useWorld } from "../../world/store";
import { notify } from "../../../shared/ui/toasts";
import { INSPECTOR_GUARD } from "../guard";
import { runPreflight } from "../preflight.functions";

/**
 * O without a GO on record: run the pre-flight first (or re-inspect, when the Inspector is the
 * one that hasn't cleared it), or open the pull request anyway.
 * The station never opens one by itself, and never without this question.
 */
export function LaunchCheck({ member, reason }: { member: CrewInfo; reason: string }) {
  const { close, open, say } = useWorld.getState();
  const run = useMutation({
    mutationFn: () => runPreflight({ data: { crewId: member.id } }),
    onSuccess: close,
  });
  const queryClient = useQueryClient();
  const again = useMutation({
    ...reinspectMutation(queryClient, member.id),
    onSuccess: ({ started }) => {
      notify(started ? "Re-inspecting…" : "Already inspecting");
      close();
    },
  });
  const inspector = reason === INSPECTOR_GUARD;
  const launch = useMutation({
    mutationFn: () => openCrewPr({ data: { crewId: member.id, force: true } }),
    onSuccess: () => {
      say(`${member.name}'s pull request is open`, "success");
      open({ kind: "pr", crewId: member.id });
    },
  });
  const second = inspector ? again : run;
  const busy = second.isPending || launch.isPending;
  return (
    <Modal icon={AirplaneTakeOff01Icon} title={`${member.name} · launch check`} subtitle={reason}>
      <ErrorNote error={second.error ?? launch.error} />
      <footer className="modal__foot">
        <Button variant="ghost" disabled={busy} onClick={close}>
          Never mind
        </Button>
        <Button
          variant="secondary"
          disabled={launch.isPending}
          loading={second.isPending}
          icon={<Icon icon={AirplaneTakeOff01Icon} />}
          onClick={() => second.mutate()}
        >
          {inspector ? "Re-inspect" : "Run pre-flight"}
        </Button>
        <Button
          variant="primary"
          disabled={second.isPending}
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
