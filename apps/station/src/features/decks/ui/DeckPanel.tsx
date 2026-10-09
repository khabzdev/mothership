import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { decksQuery, dockRepoMutation } from "../queries";

/** Bridge panel: dock a local repo and list docked decks. */
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
    <section aria-label="Decks">
      <h2>Decks</h2>
      <form onSubmit={onSubmit}>
        <label>
          Repo path{" "}
          <input
            name="repoPath"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/Users/you/code/repo"
          />
        </label>{" "}
        <button type="submit" disabled={dock.isPending || !repoPath.trim()}>
          {dock.isPending ? "Docking…" : "Dock"}
        </button>
      </form>
      {dock.error && <p role="alert">{dock.error.message}</p>}
      {decks.length === 0 ? (
        <p>No decks docked yet.</p>
      ) : (
        <ul>
          {decks.map((deck) => (
            <li key={deck.id}>
              <strong>{deck.name}</strong> · {deck.repoPath} · modules:{" "}
              {deck.modules.join(", ") || "none"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
