import { Button, Input, Loader } from "@cloudflare/kumo";
import {
  Alert02Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  KeyboardIcon,
  Notification03Icon,
  Rocket01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { rosterQuery } from "../../crew/queries";
import { useState, type CSSProperties, type FormEvent } from "react";
import {
  cancelCloneMutation,
  clonesQuery,
  decksQuery,
  dockRepoMutation,
  ghReposQuery,
  startCloneMutation,
} from "../../decks/queries";
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
  const [repo, setRepo] = useState("");
  const clone = useMutation(startCloneMutation());
  const cancel = useMutation(cancelCloneMutation());
  const { data: clones = [] } = useQuery(clonesQuery);
  const { data: suggestions = [] } = useQuery(ghReposQuery);
  const rosters = useQueries({ queries: decks.map((d) => rosterQuery(d.id)) });

  // Riding the lift, you step out of it on the deck; from the top bar, you stay where you are.
  const ride = (id: string) => {
    if (fromLift && id !== deckId) stepOutOfLift();
    choose(id);
    close();
  };

  // A folder on this machine is docked where it is; owner/name or a URL is cloned first.
  const local = repo.trim().startsWith("/");
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (local) dock.mutate(repo.trim(), { onSuccess: (deck) => ride(deck.id) });
    else clone.mutate(repo, { onSuccess: () => setRepo("") });
  };
  const error = dock.error ?? clone.error ?? cancel.error;

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
                    {busy > 0 && (
                      <span className="with-icon" title={`${busy} at work`}>
                        <Icon icon={KeyboardIcon} size={14} /> {busy}
                      </span>
                    )}
                    {waiting > 0 && (
                      <span className="with-icon" title={`${waiting} waiting on you`}>
                        <Icon icon={Notification03Icon} size={14} /> {waiting}
                      </span>
                    )}
                    {!crew.length && <span className="muted">empty</span>}
                  </span>
                  <span className="readout">{deck.repoPath}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {clones.length > 0 && (
        <ul className="lift__clones">
          {clones.map((c) => (
            <li key={c.id} data-state={c.state}>
              <span className="lift__clone-name with-icon">
                {c.state === "cloning" ? (
                  <Loader size="sm" />
                ) : (
                  <Icon icon={c.state === "done" ? CheckmarkCircle02Icon : Alert02Icon} />
                )}
                {c.name}
              </span>
              <span className="readout">{c.state === "failed" ? c.error : c.progress}</span>
              {c.state === "done" && c.deckId ? (
                <Button size="sm" variant="primary" onClick={() => ride(c.deckId!)}>
                  Go
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  shape="square"
                  title={c.state === "cloning" ? "Stop cloning" : "Dismiss"}
                  aria-label={c.state === "cloning" ? "Stop cloning" : "Dismiss"}
                  icon={<Icon icon={c.state === "cloning" ? StopCircleIcon : Cancel01Icon} />}
                  onClick={() => cancel.mutate(c.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="inline-form">
        <Input
          className="lift__input"
          label="Add a deck: clone a repo, or dock a folder"
          autoFocus={decks.length === 0}
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/name, a git URL, or /path/to/repo"
          spellCheck={false}
          list="gh-repos"
        />
        <datalist id="gh-repos">
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Button
          type="submit"
          variant="primary"
          loading={dock.isPending || clone.isPending}
          disabled={!repo.trim()}
          icon={<Icon icon={local ? Rocket01Icon : Download04Icon} />}
        >
          {local ? "Dock" : "Clone"}
        </Button>
      </form>
      <ErrorNote error={error} />
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
    <Modal
      icon={ArrowUpDownIcon}
      title="Lift"
      subtitle="Ride to a deck, or add one: clone a repo or dock a folder"
    >
      {body}
    </Modal>
  );
}
