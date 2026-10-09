import { Badge, Banner, Button, Checkbox, Empty, InputArea, Select } from "@cloudflare/kumo";
import {
  ArrowLeft01Icon,
  Logout03Icon,
  Notification03Icon,
  PlayIcon,
  SentIcon,
  UserAdd01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { useRealtime } from "../../shared/realtime/RealtimeProvider";
import { ErrorNote } from "../../shared/ui/ErrorNote";
import { Icon } from "../../shared/ui/Icon";
import { resumeCrew, sendHomeCrew } from "../crew/crew.functions";
import { hireMutation, promptMutation, rosterQuery } from "../crew/queries";
import { TerminalPanel } from "../crew/ui/TerminalPanel";
import { decksQuery } from "../decks/queries";
import { useDeckChoice } from "../world/deck-choice";
import { CONSOLES } from "../world/layout";
import { StatusBadge } from "../world/ui/StatusBadge";
import { byUrgency } from "../world/waiting";

/** The keys a phone keyboard doesn't have, for answering an agent (agent-office's /lite row). */
const KEYS: [label: string, data: string][] = [
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["Enter", "\r"],
  ["Tab", "\t"],
  ["Esc", "\x1b"],
  ["Ctrl+C", "\x03"],
];

function CrewView({ member, onBack }: { member: CrewInfo; onBack: () => void }) {
  const { client } = useRealtime();
  const prompt = useMutation(promptMutation());
  const resume = useMutation({ mutationFn: () => resumeCrew({ data: { crewId: member.id } }) });
  const home = useMutation({
    mutationFn: () => sendHomeCrew({ data: { crewId: member.id, worktree: "keep" } }),
    onSuccess: onBack,
  });
  const [text, setText] = useState("");
  const send = () =>
    text.trim() &&
    prompt.mutate({ crewId: member.id, text: text.trim() }, { onSuccess: () => setText("") });

  return (
    <section className="lite-crew">
      <header className="lite-crew__head">
        <Button
          size="sm"
          variant="ghost"
          shape="square"
          aria-label="Back to the crew"
          icon={<Icon icon={ArrowLeft01Icon} />}
          onClick={onBack}
        />
        <span className="dot" style={{ "--dot": member.color } as CSSProperties} />
        <div className="lite-crew__who">
          <strong>{member.name}</strong>
          <span className="muted">
            {CONSOLES[member.consoleId]?.label} ·{" "}
            {member.task.split("\n")[0] || (member.kind === "shell" ? "Shell" : "No task")}
          </span>
        </div>
        <StatusBadge crew={member} />
      </header>
      {member.status === "needs_input" && member.detail && (
        <Banner
          variant="error"
          icon={<Icon icon={Notification03Icon} />}
          description={member.detail}
        />
      )}
      <div className="lite-crew__term">
        <TerminalPanel crewId={member.id} />
      </div>
      <div className="lite-keys" role="toolbar" aria-label="Terminal keys">
        {KEYS.map(([label, data]) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            onClick={() => client?.send({ type: "terminal.input", crewId: member.id, data })}
          >
            {label}
          </Button>
        ))}
      </div>
      {member.kind === "agent" && (
        <form
          className="lite-prompt"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <InputArea
            aria-label={`Prompt ${member.name}`}
            placeholder={`Tell ${member.name} what to do next`}
            autoResize
            minRows={1}
            maxRows={5}
            value={text}
            onValueChange={setText}
          />
          <Button
            type="submit"
            variant="primary"
            shape="square"
            aria-label="Send"
            loading={prompt.isPending}
            disabled={!text.trim()}
            icon={<Icon icon={SentIcon} />}
          />
        </form>
      )}
      <div className="lite-actions">
        {member.status === "asleep" && (
          <Button
            variant="outline"
            loading={resume.isPending}
            icon={<Icon icon={PlayIcon} />}
            onClick={() => resume.mutate()}
          >
            {member.kind === "shell" ? "Restart" : "Resume"}
          </Button>
        )}
        <Button
          variant="secondary-destructive"
          loading={home.isPending}
          icon={<Icon icon={Logout03Icon} />}
          onClick={() => {
            const kept = member.branch ? " Its worktree and branch are kept." : "";
            if (window.confirm(`Send ${member.name} home? This stops its session.${kept}`))
              home.mutate();
          }}
        >
          Send home
        </Button>
      </div>
      <ErrorNote error={prompt.error ?? resume.error ?? home.error} />
    </section>
  );
}

function HireForm({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const queryClient = useQueryClient();
  const hire = useMutation(hireMutation(queryClient));
  const [task, setTask] = useState("");
  const [worktree, setWorktree] = useState(true);
  const free = CONSOLES.find((c) => !crew.some((m) => m.consoleId === c.id));
  if (!free) return null;
  return (
    <form
      className="lite-hire"
      onSubmit={(e) => {
        e.preventDefault();
        hire.mutate(
          { deckId, consoleId: free.id, task: task.trim(), worktree },
          { onSuccess: () => setTask("") },
        );
      }}
    >
      <InputArea
        aria-label="New task"
        placeholder={`A task for new crew at ${free.label}`}
        autoResize
        minRows={2}
        maxRows={6}
        value={task}
        onValueChange={setTask}
      />
      <div className="lite-hire__row">
        <Checkbox label="Own worktree & branch" checked={worktree} onCheckedChange={setWorktree} />
        <Button
          type="submit"
          variant="primary"
          loading={hire.isPending}
          icon={<Icon icon={UserAdd01Icon} />}
        >
          Hire
        </Button>
      </div>
      <ErrorNote error={hire.error} />
    </form>
  );
}

/** agent-office's /lite: the deck as a plain list, for a phone or a slow machine. */
export function LitePage() {
  const { data: decks } = useSuspenseQuery(decksQuery);
  const { deck, choose } = useDeckChoice();
  const [selected, setSelected] = useState<string | null>(null);
  if (!deck) {
    return (
      <main className="lite">
        <Empty title="No decks yet" description="Dock a repo from the 3D station first." />
      </main>
    );
  }
  return (
    <LiteDeck
      deckId={deck.id}
      decks={decks}
      choose={choose}
      selected={selected}
      setSelected={setSelected}
    />
  );
}

function LiteDeck({
  deckId,
  decks,
  choose,
  selected,
  setSelected,
}: {
  deckId: string;
  decks: { id: string; name: string }[];
  choose: (id: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const { data: crew } = useSuspenseQuery(rosterQuery(deckId));
  const list = byUrgency(crew);
  const member = crew.find((c) => c.id === selected);
  const needs = crew.filter((c) => c.status === "needs_input").length;
  const done = crew.filter((c) => c.status === "done").length;

  return (
    <main className="lite">
      <header className="lite__bar">
        <Select
          aria-label="Deck"
          value={deckId}
          onValueChange={(v) => {
            if (v) choose(v);
            setSelected(null);
          }}
          items={Object.fromEntries(decks.map((d) => [d.id, d.name]))}
        />
        {needs > 0 && <Badge variant="error">{needs} need you</Badge>}
        {done > 0 && <Badge variant="success">{done} done</Badge>}
        <Link to="/" className="lite__3d">
          <Icon icon={ViewIcon} /> 3D
        </Link>
      </header>
      {member ? (
        <CrewView member={member} onBack={() => setSelected(null)} />
      ) : (
        <>
          <ul className="lite-list">
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" data-status={c.status} onClick={() => setSelected(c.id)}>
                  <span className="dot" style={{ "--dot": c.color } as CSSProperties} />
                  <span className="lite-list__who">
                    <strong>{c.name}</strong>
                    <span className="muted">
                      {CONSOLES[c.consoleId]?.label} ·{" "}
                      {c.status === "needs_input" && c.detail
                        ? c.detail
                        : c.task.split("\n")[0] || (c.kind === "shell" ? "Shell" : "No task")}
                    </span>
                  </span>
                  <StatusBadge crew={c} />
                </button>
              </li>
            ))}
            {!list.length && (
              <li>
                <Empty
                  size="sm"
                  title="No crew on this deck yet"
                  description="Hire someone below to get started."
                />
              </li>
            )}
          </ul>
          <HireForm deckId={deckId} crew={crew} />
        </>
      )}
    </main>
  );
}
