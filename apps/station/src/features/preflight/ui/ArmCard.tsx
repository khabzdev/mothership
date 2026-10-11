import { Button, Surface } from "@cloudflare/kumo";
import { AirplaneTakeOff01Icon } from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@spaceship/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { gameKeysEnabled, useWorld } from "../../world/store";
import { armChecksMutation, checksQuery } from "../queries";

/**
 * Flight Control's one question: the first time the deck's checks are found and there's crew
 * on a branch, arm them? Y arms; looking first (Flight Control) and saying no are buttons, so E
 * and N keep their usual game meaning while the card shows.
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

  // Y arms, and only while shown.
  const act = useRef({ shown, busy: arm.isPending, arm: arm.mutate });
  act.current = { shown, busy: arm.isPending, arm: arm.mutate };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { shown, busy, arm } = act.current;
      if (!shown || !gameKeysEnabled(e) || e.code !== "KeyY") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!busy) arm(true);
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
          Don&apos;t arm
        </Button>
        <Button variant="secondary" onClick={() => open({ kind: "flightControl" })}>
          Edit first
        </Button>
        <Button variant="primary" loading={arm.isPending} onClick={() => arm.mutate(true)}>
          <kbd>Y</kbd> Arm
        </Button>
      </div>
    </Surface>
  );
}
