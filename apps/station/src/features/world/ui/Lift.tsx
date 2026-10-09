import { useMutation, useQueries, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { rosterQuery } from "../../crew/queries";
import { useState, type CSSProperties, type FormEvent } from "react";
import { decksQuery, dockRepoMutation } from "../../decks/queries";
import { useDeckChoice } from "../deck-choice";
import { paintFor } from "../paint";
import { stepOutOfLift } from "../scene/Captain";
import { waitingOnYou } from "../waiting";
import { useWorld } from "../store";
import { Modal } from "./Modal";

/** The lift: ride to another deck, or dock a new repo as a deck (agent-office's elevator). */
export function Lift({
  standalone = false,
  fromLift = false,
}: {
  standalone?: boolean;
  fromLift?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: decks } = useSuspenseQuery(decksQuery);
  const dock = useMutation(dockRepoMutation(queryClient));
  const { deckId, choose } = useDeckChoice();
  const close = useWorld((s) => s.close);
  const [repoPath, setRepoPath] = useState("");
  const rosters = useQueries({ queries: decks.map((d) => rosterQuery(d.id)) });

  // Riding the lift, you step out of it on the deck; from the top bar, you stay where you are.
  const ride = (id: string) => {
    if (fromLift && id !== deckId) stepOutOfLift();
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
          {decks.map((deck, i) => {
            const crew = rosters[i]?.data ?? [];
            const busy = crew.filter((c) => c.status === "working").length;
            const waiting = crew.filter(waitingOnYou).length;
            const asking = crew.some((c) => c.status === "needs_input");
            return (
              <li key={deck.id}>
                <button
                  type="button"
                  className="lift__deck"
                  aria-current={deck.id === deckId}
                  data-asking={asking || undefined}
                  style={{ "--deck-trim": paintFor(deck.repoPath).trim } as CSSProperties}
                  onClick={() => ride(deck.id)}
                >
                  <span className="lift__level">{i + 1}</span>
                  <span className="lift__name">{deck.name}</span>
                  <span className="lift__counts">
                    {busy > 0 && <span title={`${busy} at work`}>⌨️ {busy}</span>}
                    {waiting > 0 && <span title={`${waiting} waiting on you`}>🙋 {waiting}</span>}
                    {!crew.length && <span className="muted">empty</span>}
                  </span>
                  <span className="readout">{deck.repoPath}</span>
                </button>
              </li>
            );
          })}
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
