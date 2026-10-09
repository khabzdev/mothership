import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { diagnosticsQuery } from "../app/queries";
import { rosterQuery } from "../features/crew/queries";
import { decksQuery } from "../features/decks/queries";
import { useDeckChoice } from "../features/world/deck-choice";
import { Lift } from "../features/world/ui/Lift";

// three.js and the scene only load in the browser.
const Game = lazy(() => import("../features/world/Game").then((m) => ({ default: m.Game })));

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const [decks] = await Promise.all([
      context.queryClient.ensureQueryData(decksQuery),
      context.queryClient.ensureQueryData(diagnosticsQuery),
    ]);
    await Promise.all(decks.map((d) => context.queryClient.ensureQueryData(rosterQuery(d.id))));
  },
  ssr: "data-only",
  component: Station,
});

function Station() {
  const { deck } = useDeckChoice();
  if (!deck) return <Lift standalone />;
  return (
    <Suspense fallback={<div className="loading">Boarding {deck.name}…</div>}>
      <Game deck={deck} />
    </Suspense>
  );
}
