import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { decksQuery } from "../features/decks/queries";
import { missionsQuery } from "../features/missions/queries";
import { MissionBoard } from "../features/missions/ui/MissionBoard";

export const Route = createFileRoute("/decks/$deckId")({
  loader: async ({ context, params }) => {
    const decks = await context.queryClient.ensureQueryData(decksQuery);
    if (!decks.some((d) => d.id === params.deckId)) throw notFound();
    await context.queryClient.ensureQueryData(missionsQuery(params.deckId));
  },
  component: DeckPage,
  notFoundComponent: () => (
    <main className="deck">
      <p className="error">No such deck.</p>
      <Link to="/">Back to the bridge</Link>
    </main>
  ),
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const { data: decks } = useSuspenseQuery(decksQuery);
  const deck = decks.find((d) => d.id === deckId)!;

  return (
    <main className="deck">
      <header className="deck__head">
        <p className="eyebrow">
          <Link to="/">Bridge</Link> / Deck
        </p>
        <h1>{deck.name}</h1>
        <p className="readout">{deck.repoPath}</p>
        <ul className="modules">
          {deck.modules.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </header>
      <MissionBoard deckId={deckId} />
    </main>
  );
}
