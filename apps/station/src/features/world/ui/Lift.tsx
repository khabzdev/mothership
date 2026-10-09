import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { decksQuery, dockRepoMutation } from "../../decks/queries";
import { useDeckChoice } from "../deck-choice";
import { useWorld } from "../store";
import { Modal } from "./Modal";

/** The lift: ride to another deck, or dock a new repo as a deck (agent-office's elevator). */
export function Lift({ standalone = false }: { standalone?: boolean }) {
  const queryClient = useQueryClient();
  const { data: decks } = useSuspenseQuery(decksQuery);
  const dock = useMutation(dockRepoMutation(queryClient));
  const { deckId, choose } = useDeckChoice();
  const close = useWorld((s) => s.close);
  const [repoPath, setRepoPath] = useState("");

  const ride = (id: string) => {
    choose(id);
    close();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    dock.mutate(repoPath, { onSuccess: (deck) => ride(deck.id) });
  };

  const body = (
    <>
      {decks.length > 0 && (
        <ul className="lift__decks">
          {decks.map((deck, i) => (
            <li key={deck.id}>
              <button
                type="button"
                className="lift__deck"
                aria-current={deck.id === deckId}
                onClick={() => ride(deck.id)}
              >
                <span className="lift__level">{i + 1}</span>
                <span className="lift__name">{deck.name}</span>
                <span className="readout">{deck.repoPath}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="inline-form">
        <label className="field">
          <span className="field__label">Dock a repo as a new deck</span>
          <input
            autoFocus={decks.length === 0}
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
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
    </>
  );

  if (standalone) {
    return (
      <main className="lift-screen">
        <p className="eyebrow">Mothership</p>
        <h1>Dock your first deck</h1>
        <p className="muted">Every repo is a deck. Crew work at its consoles.</p>
        {body}
      </main>
    );
  }
  return (
    <Modal title="🛗 Lift" subtitle="Ride to a deck, or dock a repo">
      {body}
    </Modal>
  );
}
