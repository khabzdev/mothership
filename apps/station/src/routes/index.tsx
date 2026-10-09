import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { healthQuery } from "../app/health";
import { diagnosticsQuery } from "../app/queries";
import { StationChecks } from "../app/ui/StationChecks";
import { decksQuery } from "../features/decks/queries";
import { DeckPanel } from "../features/decks/ui/DeckPanel";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(healthQuery),
      context.queryClient.ensureQueryData(decksQuery),
      context.queryClient.ensureQueryData(diagnosticsQuery),
    ]),
  component: Bridge,
});

function Bridge() {
  const { data } = useSuspenseQuery(healthQuery);
  return (
    <main className="bridge">
      <section className="bridge__title">
        <p className="eyebrow">Command bridge</p>
        <h1>Every repo is a deck. Every feature is a mission.</h1>
        <p className="readout" data-testid="station-status">
          Station {data.status} · node {data.node} · db {data.db}
        </p>
      </section>
      <DeckPanel />
      <StationChecks />
    </main>
  );
}
