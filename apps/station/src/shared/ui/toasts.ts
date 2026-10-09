import { createKumoToastManager } from "@cloudflare/kumo";

/** The deck's toasts (agent-office's), shown by the Toasty in the game; dispatch from anywhere. */
export const toasts = createKumoToastManager();

export type Tone = "default" | "success" | "error" | "warning" | "info";

/** A toast for a message: errors linger a little longer. */
export function toastOf(text: string, tone: Tone = "default") {
  return { title: text, variant: tone, timeout: tone === "error" ? 6000 : 3500 };
}

/** Show a short message. */
export function notify(text: string, tone?: Tone): void {
  toasts.add(toastOf(text, tone));
}
