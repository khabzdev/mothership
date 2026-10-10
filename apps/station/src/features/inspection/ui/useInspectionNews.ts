import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useRef } from "react";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import { notify } from "../../../shared/ui/toasts";
import { inspectionFailedToast } from "../model";

/** The Inspector couldn't run for a crew member on the deck being viewed: a warning toast, once. */
export function useInspectionNews(deckId: string, crew: CrewInfo[]): void {
  const { client } = useRealtime();
  const roster = useRef(crew);
  roster.current = crew;
  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type !== "crew.inspection" || msg.deckId !== deckId) return;
      if (msg.state !== "cancelled" || msg.failed === undefined) return;
      const name = roster.current.find((c) => c.id === msg.crewId)?.name ?? "this crew member";
      notify(inspectionFailedToast(name, msg.failed), "warning");
    });
  }, [client, deckId]);
}
