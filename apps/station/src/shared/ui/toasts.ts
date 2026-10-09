import { createKumoToastManager } from "@cloudflare/kumo";

/** The deck's toasts (agent-office's), shown by the Toasty in the game; dispatch from anywhere. */
export const toasts = createKumoToastManager();

type Variant = "default" | "success" | "error" | "warning" | "info";

/** A message's tone, read off the emoji the game starts it with. */
export function toneOf(text: string): Variant {
  if (text.startsWith("⚠️")) return "error";
  if (/^(👍|✅|🚀)/u.test(text)) return "success";
  if (/^(🙋|🛗)/u.test(text)) return "warning";
  return "default";
}

/** Show a short message: errors linger a little longer. */
export function notify(text: string): void {
  const variant = toneOf(text);
  // Kumo's toast shows its own icon for the tone: the emoji the message starts with goes.
  toasts.add({
    title: text.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, ""),
    variant,
    timeout: variant === "error" ? 6000 : 3500,
  });
}
