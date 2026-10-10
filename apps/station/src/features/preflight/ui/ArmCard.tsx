import { Button, Surface } from "@cloudflare/kumo";
import { AirplaneTakeOff01Icon } from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { gameKeysEnabled, useWorld } from "../../world/store";
import { armChecksMutation, checksQuery } from "../queries";

/**
 * Flight Control's one question: the first time the deck's checks are found and there's crew
 * on a branch, arm them? Y arms, E opens Flight Control to look first, N says no.
 */
export function ArmCard({
  deckId,
  deckName,
  crew,
}: {
  deckId: string;
  deckName: string;
  crew: CrewInfo[];
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery(checksQuery(deckId));
  const arm = useMutation(armChecksMutation(queryClient, deckId));
  const open = useWorld((s) => s.open);
  const checks = data?.checks ?? [];
  const shown =
    data?.armed === null && checks.length > 0 && crew.some((c) => c.kind === "agent" && c.branch);

  // The keys act before any other game key (N also jumps to waiting crew), and only while shown.
  const act = useRef({ shown, busy: arm.isPending, arm: arm.mutate, open });
  act.current = { shown, busy: arm.isPending, arm: arm.mutate, open };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { shown, busy, arm, open } = act.current;
      if (!shown || !gameKeysEnabled(e)) return;
      if (e.code !== "KeyY" && e.code !== "KeyE" && e.code !== "KeyN") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "KeyE") return open({ kind: "flightControl" });
      if (!busy) arm(e.code === "KeyY");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!shown) return null;
  const names = checks.map((c) => c.name).join(" · ");
  return (
    <Surface className="arm-card" role="dialog" aria-label="Arm pre-flight checks">
      <p className="arm-card__text with-icon">
        <Icon icon={AirplaneTakeOff01Icon} />
        Flight Control found {checks.length} checks for {deckName}: {names}. Arm them?
      </p>
      <ErrorNote error={arm.error} />
      <div className="arm-card__actions">
        <Button variant="ghost" disabled={arm.isPending} onClick={() => arm.mutate(false)}>
          <kbd>N</kbd> Don&apos;t arm
        </Button>
        <Button variant="secondary" onClick={() => open({ kind: "flightControl" })}>
          <kbd>E</kbd> Edit first
        </Button>
        <Button variant="primary" loading={arm.isPending} onClick={() => arm.mutate(true)}>
          <kbd>Y</kbd> Arm
        </Button>
      </div>
    </Surface>
  );
}
