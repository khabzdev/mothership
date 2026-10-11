import { useEffect } from "react";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import { notify } from "../../../shared/ui/toasts";
import { chime, speak } from "../../world/sound";
import { voiceOn } from "../../world/usePreflightPoll";
import { debriefToast, promotionLine } from "../model";

/**
 * News from the deck being viewed: a debrief's lessons to review (with a soft chime, never a
 * needs-you alert) or why it couldn't run, and promotions and patches (read aloud with the poll's
 * voice on).
 */
export function useDebriefNews(deckId: string): void {
  const { client } = useRealtime();
  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type === "deck.debrief" && msg.deckId === deckId) {
        const toast = debriefToast(msg);
        if (!toast) return;
        notify(toast.text, toast.tone);
        if (toast.tone === "default") chime();
      } else if (msg.type === "crew.promoted" && msg.deckId === deckId) {
        const line = promotionLine(msg);
        if (!line) return;
        notify(line, "success");
        if (voiceOn()) speak(line);
      }
    });
  }, [client, deckId]);
}
