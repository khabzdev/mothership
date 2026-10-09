import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { decksQuery, dockRepoMutation } from "../queries";

/** Bridge panel: dock a local repo and pick a deck. */
export function DeckPanel() {
  const queryClient = useQueryClient();
  const { data: decks } = useSuspenseQuery(decksQuery);
  const dock = useMutation(dockRepoMutation(queryClient));
  const [repoPath, setRepoPath] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    dock.mutate(repoPath, { onSuccess: () => setRepoPath("") });
  };

  return (
    <section className="panel" aria-label="Decks">
      <h2 className="stencil">Decks</h2>
      {decks.length === 0 ? (
        <p className="muted">No decks docked yet. Dock a git repo to open its deck.</p>
      ) : (
        <ul className="deck-list">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link to="/decks/$deckId" params={{ deckId: deck.id }} className="deck-link">
                <span className="deck-link__name">{deck.name}</span>
                <span className="readout">{deck.modules.length} modules</span>
                <span className="deck-link__path">{deck.repoPath}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="inline-form">
        <label className="field">
          <span className="field__label">Dock a repo</span>
          <input
            name="repoPath"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/Users/you/code/repo"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="button" disabled={dock.isPending || !repoPath.trim()}>
          {dock.isPending ? "Docking…" : "Dock"}
        </button>
      </form>
      {dock.error && (
        <p role="alert" className="error">
          {dock.error.message}
        </p>
      )}
    </section>
  );
}
