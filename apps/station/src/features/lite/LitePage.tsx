import { Badge, Banner, Button, Checkbox, Empty, Input, InputArea, Select } from "@cloudflare/kumo";
import {
  AirplaneTakeOff01Icon,
  ArrowLeft01Icon,
  Logout03Icon,
  Notification03Icon,
  PlayIcon,
  SentIcon,
  UserAdd01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@mothership/protocol";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { useRealtime } from "../../shared/realtime/RealtimeProvider";
import { ErrorNote } from "../../shared/ui/ErrorNote";
import { Icon } from "../../shared/ui/Icon";
import { resumeCrew, sendHomeCrew } from "../crew/crew.functions";
import { hireMutation, promptMutation, rosterQuery } from "../crew/queries";
import { TerminalPanel } from "../crew/ui/TerminalPanel";
import { decksQuery } from "../decks/queries";
import { REASON_MAX } from "../briefs/model";
import { approveBriefMutation, briefQuery, reviseBriefMutation } from "../briefs/queries";
import { BriefText } from "../briefs/ui/BriefText";
import { preflightChip } from "../preflight/model";
import { preflightQuery, runPreflightMutation } from "../preflight/queries";
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

const RESULT_TONE = { go: "success", nogo: "error", skipped: "neutral" } as const;

/** A manual pre-flight and the latest results, for crew in their own worktree. */
function LitePreflight({ member }: { member: CrewInfo }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...preflightQuery(member.id),
    refetchInterval: (query) => (query.state.data?.latest?.state === "running" ? 2000 : false),
  });
  const run = useMutation(runPreflightMutation(queryClient, member.id));
  const latest = data?.latest;
  const running = latest?.state === "running" || member.preflight?.state === "running";
  return (
    <section className="lite-preflight" aria-label="Pre-flight">
      <div className="lite-preflight__bar">
        <Button
          variant="outline"
          icon={<Icon icon={AirplaneTakeOff01Icon} />}
          loading={run.isPending}
          disabled={running}
          onClick={() => run.mutate()}
        >
          Run pre-flight
        </Button>
        {run.data?.id === null && (
          <span className="muted">Needs its own worktree and armed checks on this deck.</span>
        )}
      </div>
      {latest && latest.results.length > 0 && (
        <ul className="lite-preflight__list">
          {latest.results.map((r) => (
            <li key={r.checkId}>
              <Badge variant={RESULT_TONE[r.verdict]} appearance="dot">
                {r.verdict === "go" ? "GO" : r.verdict === "nogo" ? "NO-GO" : "Skipped"}
              </Badge>
              <span>{r.name}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={run.error} />
    </section>
  );
}

const briefTone = (info: NonNullable<CrewInfo["brief"]>) =>
  info.state === "waiting" ? "warning" : "neutral";

type BriefResult = { ok: true } | { ok: false; message: string; openTerminal: boolean };

/** The brief to read, and while it waits, approve or send back with a reason. */
function LiteBrief({ member, brief }: { member: CrewInfo; brief: NonNullable<CrewInfo["brief"]> }) {
  const queryClient = useQueryClient();
  const { data } = useQuery(briefQuery(member.id));
  const approve = useMutation(approveBriefMutation(queryClient, member.id));
  const revise = useMutation(reviseBriefMutation(queryClient, member.id));
  const [open, setOpen] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const latest = data?.[0];
  const waiting = brief.state === "waiting" && latest?.state === "waiting";
  const busy = approve.isPending || revise.isPending;

  const settle = (result: BriefResult, onOk?: () => void) => {
    if (result.ok) {
      setMessage(null);
      onOk?.();
    } else setMessage(result.message);
  };

  return (
    <section className="lite-brief" aria-label="Brief">
      <Button
        variant="ghost"
        className="lite-brief__chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Badge variant={briefTone(brief)} appearance="dot">
          Brief
        </Badge>
        <span className="muted">Rev {brief.revision}</span>
      </Button>
      {open && (
        <div className="lite-brief__sheet">
          {latest ? <BriefText text={latest.text} /> : <p className="muted">Loading…</p>}
          {waiting &&
            (revising ? (
              <form
                className="lite-brief__revise"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = reason.trim();
                  if (!text || busy) return;
                  revise.mutate(text, {
                    onSuccess: (result) =>
                      settle(result, () => {
                        setRevising(false);
                        setReason("");
                      }),
                  });
                }}
              >
                <Input
                  aria-label="What to change"
                  placeholder="What should change?"
                  maxLength={REASON_MAX}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  loading={revise.isPending}
                  disabled={!reason.trim()}
                >
                  Send
                </Button>
              </form>
            ) : (
              <div className="lite-brief__actions">
                <Button variant="secondary" disabled={busy} onClick={() => setRevising(true)}>
                  Revise
                </Button>
                <Button
                  variant="primary"
                  loading={approve.isPending}
                  disabled={busy}
                  onClick={() =>
                    approve.mutate(undefined, { onSuccess: (result) => settle(result) })
                  }
                >
                  Approve
                </Button>
              </div>
            ))}
          {message && <p className="lite-brief__note">{message}</p>}
          <ErrorNote error={approve.error ?? revise.error} />
        </div>
      )}
    </section>
  );
}

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
      {member.brief && <LiteBrief member={member} brief={member.brief} />}
      {member.kind === "agent" && <LitePreflight member={member} />}
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

function PreflightChip({ info }: { info?: CrewInfo["preflight"] }) {
  const chip = preflightChip(info);
  return (
    chip && (
      <Badge variant={chip.tone} appearance="dot">
        {chip.label}
      </Badge>
    )
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
                  <span className="lite-list__badges">
                    <StatusBadge crew={c} />
                    {c.brief && (
                      <Badge variant={briefTone(c.brief)} appearance="dot">
                        Brief
                      </Badge>
                    )}
                    <PreflightChip info={c.preflight} />
                  </span>
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
