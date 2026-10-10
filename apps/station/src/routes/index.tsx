import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Boarding } from "../features/world/ui/Boarding";
import { diagnosticsQuery } from "../app/queries";
import { rosterQuery } from "../features/crew/queries";
import { decksQuery } from "../features/decks/queries";
import { labelsQuery } from "../features/labels/queries";
import { useDeckChoice } from "../features/world/deck-choice";
import { FlightPlan } from "../features/world/ui/FlightPlan";

// three.js and the scene only load in the browser.
const Game = lazy(() => import("../features/world/Game").then((m) => ({ default: m.Game })));

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const [decks] = await Promise.all([
      context.queryClient.ensureQueryData(decksQuery),
      context.queryClient.ensureQueryData(diagnosticsQuery),
    ]);
    await Promise.all(
      decks.flatMap((d) => [
        context.queryClient.ensureQueryData(rosterQuery(d.id)),
        context.queryClient.ensureQueryData(labelsQuery(d.id)),
      ]),
    );
  },
  ssr: "data-only",
  component: Station,
});

function Station() {
  const { deck } = useDeckChoice();
  if (!deck) return <FlightPlan standalone />;
  return (
    <Suspense fallback={<Boarding deck={deck.name} />}>
      <Game deck={deck} />
    </Suspense>
  );
}
