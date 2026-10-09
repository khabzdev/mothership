import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { healthQuery } from "../app/health";
import { decksQuery } from "../features/decks/queries";
import { DeckPanel } from "../features/decks/ui/DeckPanel";
import { useRealtime } from "../shared/realtime/RealtimeProvider";

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
  const realtime = useRealtime();
  return (
    <main>
      <h1>Mothership</h1>
      <p>Command Bridge</p>
      <p data-testid="station-status">
        Station {data.status} · node {data.node} · db {data.db}
      </p>
      <p data-testid="realtime-status">Comms {realtime.state}</p>
      <DeckPanel />
    </main>
  );
}
