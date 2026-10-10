import { Button, Input, Loader } from "@cloudflare/kumo";
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  KeyboardIcon,
  Notification03Icon,
  Rocket01Icon,
  SpaceshipIcon,
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
import { rideAction } from "../ship";
import { waitingOnYou } from "../waiting";
import { useWorld } from "../store";
import { Modal } from "./Modal";

/** The Flight plan: fly to another deck, or dock a new repo as a deck (agent-office's elevator). */
export function FlightPlan({
  standalone = false,
  fromShip = false,
}: {
  standalone?: boolean;
  fromShip?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: decks } = useSuspenseQuery(decksQuery);
  const dock = useMutation(dockRepoMutation(queryClient));
  const { deckId, choose } = useDeckChoice();
  const close = useWorld((s) => s.close);
  const startFlight = useWorld((s) => s.startFlight);
  const [repo, setRepo] = useState("");
  const clone = useMutation(startCloneMutation());
  const cancel = useMutation(cancelCloneMutation());
  const { data: clones = [] } = useQuery(clonesQuery);
  const { data: suggestions = [] } = useQuery(ghReposQuery);
  const rosters = useQueries({ queries: decks.map((d) => rosterQuery(d.id)) });

  // From your ship you take off and the deck switches once you're away; from the top bar or the
  // palette it switches at once and you stay where you are.
  const ride = (id: string) => {
    const action = rideAction(fromShip, id, deckId);
    if (action === "fly") startFlight(id, deckId);
    else if (action === "choose") choose(id);
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
        <ul className="flightplan__decks">
          {decks.map((deck, i) => {
            const crew = rosters[i]?.data ?? [];
            const busy = crew.filter((c) => c.status === "working").length;
            const waiting = crew.filter(waitingOnYou).length;
            const asking = crew.some((c) => c.status === "needs_input");
            return (
              <li key={deck.id}>
                <button
                  type="button"
                  className="flightplan__deck"
                  aria-current={deck.id === deckId}
                  data-asking={asking || undefined}
                  onClick={() => ride(deck.id)}
                >
                  <span className="flightplan__level">{i + 1}</span>
                  <span className="flightplan__name">
                    <span
                      className="dot"
                      style={{ "--dot": paintFor(deck.repoPath).trim } as CSSProperties}
                    />
                    {deck.name}
                  </span>
                  <span className="flightplan__counts">
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
                  <span className="meta" title={deck.repoPath}>
                    <bdi>{deck.repoPath}</bdi>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {clones.length > 0 && (
        <ul className="flightplan__clones">
          {clones.map((c) => (
            <li key={c.id} data-state={c.state}>
              <span className="flightplan__clone-name with-icon">
                {c.state === "cloning" ? (
                  <Loader size="sm" />
                ) : (
                  <Icon icon={c.state === "done" ? CheckmarkCircle02Icon : Alert02Icon} />
                )}
                {c.name}
              </span>
              <span className="meta">{c.state === "failed" ? c.error : c.progress}</span>
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
          className="flightplan__input"
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
      <main className="flightplan-screen">
        <p className="section-label">Mothership</p>
        <h1>Dock your first deck</h1>
        <p className="muted">Every repo is a deck. Crew work at its consoles.</p>
        {body}
      </main>
    );
  }
  return (
    <Modal
      icon={SpaceshipIcon}
      title="Flight plan"
      subtitle="Fly to a deck, or add one: clone a repo or dock a folder"
    >
      {body}
    </Modal>
  );
}
