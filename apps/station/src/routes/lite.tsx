import { createFileRoute } from "@tanstack/react-router";
import { diagnosticsQuery } from "../app/queries";
import { rosterQuery } from "../features/crew/queries";
import { decksQuery } from "../features/decks/queries";
import { LitePage } from "../features/lite/LitePage";

/** The station as a plain list (agent-office's /lite): for a phone or a slow machine. */
export const Route = createFileRoute("/lite")({
  loader: async ({ context }) => {
    const [decks] = await Promise.all([
      context.queryClient.ensureQueryData(decksQuery),
      context.queryClient.ensureQueryData(diagnosticsQuery),
    ]);
    await Promise.all(decks.map((d) => context.queryClient.ensureQueryData(rosterQuery(d.id))));
  },
  ssr: "data-only",
  head: () => ({ meta: [{ title: "Spaceship · lite" }] }),
  component: LitePage,
});
