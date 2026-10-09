import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { healthQuery } from "../app/health";
import { decksQuery } from "../features/decks/queries";
import { DeckPanel } from "../features/decks/ui/DeckPanel";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(healthQuery),
      context.queryClient.ensureQueryData(decksQuery),
    ]),
  component: Bridge,
});

function Bridge() {
  const { data } = useSuspenseQuery(healthQuery);
  return (
    <main>
      <h1>Mothership</h1>
      <p>Command Bridge</p>
      <p data-testid="station-status">
        Station {data.status} · node {data.node} · db {data.db}
      </p>
      <DeckPanel />
    </main>
  );
}
