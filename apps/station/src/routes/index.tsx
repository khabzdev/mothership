import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { healthQuery } from "../app/health";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQuery),
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
    </main>
  );
}
