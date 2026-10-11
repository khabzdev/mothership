import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Empty,
  Input,
  InputArea,
  Select,
  Toasty,
} from "@cloudflare/kumo";
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
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { diagnosticsQuery } from "../../app/queries";
import { NO_SMOKE } from "../../app/smoke";
import { useRealtime } from "../../shared/realtime/RealtimeProvider";
import { ErrorNote } from "../../shared/ui/ErrorNote";
import { notify, toasts } from "../../shared/ui/toasts";
import { Icon } from "../../shared/ui/Icon";
import { resumeCrew, sendHomeCrew } from "../crew/crew.functions";
import { hireMutation, promptMutation, rosterQuery } from "../crew/queries";
import { TerminalPanel } from "../crew/ui/TerminalPanel";
import { MAX_KEPT_LESSONS } from "../debrief/model";
import { lessonMutation, lessonsQuery, type LessonAction } from "../debrief/queries";
import type { Lesson } from "../debrief/debrief.server";
import { useDebriefNews } from "../debrief/ui/useDebriefNews";
import { decksQuery } from "../decks/queries";
import { endedAgo } from "../log/model";
import { logQuery, missionQuery } from "../log/queries";
import type { MissionSummary } from "../log/log.server";
import { MissionEntryView, VERDICT_TONE } from "../log/ui/MissionEntry";
import { REASON_MAX } from "../briefs/model";
import { approveBriefMutation, briefQuery, reviseBriefMutation } from "../briefs/queries";
import { BriefText } from "../briefs/ui/BriefText";
import { inspectionChip, windowSections } from "../inspection/model";
import { inspectionQuery, reinspectMutation } from "../inspection/queries";
import { FindingList } from "../inspection/ui/FindingList";
import { InspectorSwitch } from "../inspection/ui/InspectorSwitch";
import { useInspectionNews } from "../inspection/ui/useInspectionNews";
import { preflightChip } from "../preflight/model";
import { checksQuery, preflightQuery, runPreflightMutation } from "../preflight/queries";
import { RankChevrons } from "../ranks/ui/RankChevrons";
import { ServiceRecordWindow } from "../ranks/ui/ServiceRecordWindow";
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

type Chip = { label: string; tone: "warning" | "success" | "error" };

/** A pre-flight or inspection chip (see preflightChip / inspectionChip) as a dot badge. */
function ChipBadge({ chip }: { chip: Chip | null }) {
  return (
    chip && (
      <Badge variant={chip.tone} appearance="dot">
        {chip.label}
      </Badge>
    )
  );
}

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

/** The latest inspection as a chip that opens its findings, with Re-inspect once it's done. */
function LiteInspection({ member }: { member: CrewInfo }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // The history is only read while its sheet is open.
  const { data } = useQuery({ ...inspectionQuery(member.id), enabled: open });
  const again = useMutation(reinspectMutation(queryClient, member.id));
  const chip = inspectionChip(member.inspection);
  const { current, blockers, notes } = windowSections(data ?? []);
  const running = member.inspection?.state === "running" || current?.state === "running";
  if (!chip) return null;
  return (
    <section className="lite-inspection" aria-label="Inspection">
      <Button
        variant="ghost"
        className="lite-inspection__chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChipBadge chip={chip} />
      </Button>
      {open && (
        <div className="lite-inspection__sheet">
          {!data && <p className="muted">Loading…</p>}
          {current?.reason && <p className="lite-inspection__note">{current.reason}</p>}
          <FindingList heading="Blockers" findings={blockers} />
          <FindingList heading="Notes" findings={notes} />
          {/* Only a run that finished can have found nothing; a failed or cancelled one has its reason. */}
          {current?.state === "cleared" && !blockers.length && !notes.length && (
            <p className="lite-inspection__note">Nothing found.</p>
          )}
          <div className="lite-inspection__actions">
            <Button
              variant="secondary"
              loading={again.isPending}
              disabled={running}
              onClick={() =>
                again.mutate(undefined, {
                  onSuccess: ({ started }) =>
                    notify(started ? "Re-inspecting…" : "Already inspecting"),
                })
              }
            >
              Re-inspect
            </Button>
          </div>
          <ErrorNote error={again.error} />
        </div>
      )}
    </section>
  );
}

/** When the real-claude smoke last passed, and which of its checks failed. */
function LiteSmoke() {
  const { data } = useQuery(diagnosticsQuery);
  const smoke = data?.smoke ?? NO_SMOKE;
  return (
    <section className="lite-smoke" aria-label="Smoke" data-smoke={smoke.state}>
      <p className="muted">{smoke.line}</p>
      {smoke.failed.length > 0 && (
        <ul className="lite-smoke__failed">
          {smoke.failed.map((check) => (
            <li key={check.id}>
              <code>{check.id}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const NO_LESSONS: Lesson[] = [];

/** The deck's debrief lessons: Keep or Drop what waits, Retire what is kept. */
function LiteLessons({ deckId }: { deckId: string }) {
  const queryClient = useQueryClient();
  const { data: checks } = useQuery(checksQuery(deckId));
  const [open, setOpen] = useState(false);
  // The lessons are only read while the section is open.
  const { data, error } = useQuery({ ...lessonsQuery(deckId), enabled: open });
  const answer = useMutation(lessonMutation(queryClient, deckId));
  const pending = data?.pending ?? NO_LESSONS;
  const kept = data?.kept ?? NO_LESSONS;
  const waiting = checks?.lessonsPending ?? 0;

  const act = (action: LessonAction, lessonId: string) =>
    answer.mutate(
      { action, lessonId },
      {
        onSuccess: (result) => {
          if (!result.ok) notify(result.message, "warning");
        },
        onError: (e: Error) => notify(e.message, "error"),
      },
    );

  const row = (lesson: Lesson, actions: [label: string, action: LessonAction][]) => (
    <li key={lesson.id} className="lite-lessons__item">
      <span className="lite-lessons__text">{lesson.text}</span>
      <span className="muted">from {lesson.fromName}</span>
      {lesson.state === "pending" && lesson.evidence && (
        <span className="muted">{lesson.evidence}</span>
      )}
      <div className="lite-lessons__actions">
        {actions.map(([label, action]) => (
          <Button
            key={action}
            size="sm"
            variant={action === "keep" ? "primary" : "secondary"}
            disabled={answer.isPending}
            onClick={() => act(action, lesson.id)}
          >
            {label}
          </Button>
        ))}
      </div>
    </li>
  );

  return (
    <section className="lite-lessons" aria-label="Lessons">
      <Button
        variant="ghost"
        className="lite-lessons__chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>Lessons</strong>
        {waiting > 0 && (
          <Badge variant="warning" appearance="dot">
            {waiting} to review
          </Badge>
        )}
      </Button>
      {open && (
        <div className="lite-lessons__sheet">
          {!data && !error && <p className="muted">Loading…</p>}
          <ErrorNote error={error} />
          {data && !pending.length && !kept.length && (
            <p className="muted">No lessons yet. A mission that hits trouble drafts some here.</p>
          )}
          {pending.length > 0 && (
            <ul className="lite-lessons__list" aria-label="To review">
              {pending.map((l) =>
                row(l, [
                  ["Drop", "drop"],
                  ["Keep", "keep"],
                ]),
              )}
            </ul>
          )}
          {kept.length > 0 && (
            <>
              <p className="muted">
                Kept · {kept.length} of {MAX_KEPT_LESSONS}
              </p>
              <ul className="lite-lessons__list" aria-label="Kept">
                {kept.map((l) => row(l, [["Retire", "retire"]]))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const NO_MISSIONS: MissionSummary[] = [];

/** One mission's entry under its row, fetched when the row opens. */
function LiteLogEntry({ deckId, missionId }: { deckId: string; missionId: string }) {
  const { data, error } = useQuery(missionQuery(deckId, missionId));
  const [showOutput, setShowOutput] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (data === undefined) return <p className="muted">Loading…</p>;
  if (data === null) return <p className="muted">This mission isn't in the log.</p>;
  const hasNogo = data.preflights.some((r) => r.state === "nogo");
  return (
    <div className="lite-log__entry">
      {hasNogo && (
        <Button size="sm" variant="secondary" onClick={() => setShowOutput(!showOutput)}>
          {showOutput ? "Hide output" : "Show output"}
        </Button>
      )}
      <MissionEntryView deckId={deckId} entry={data} showOutput={showOutput} />
    </div>
  );
}

/** The Captain's log: every mission that ended, newest first; tap one to read its evidence. */
function LiteLog({ deckId }: { deckId: string }) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // The log is only read while the section is open.
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    ...logQuery(deckId),
    enabled: open,
  });
  const missions = data?.pages.flat() ?? NO_MISSIONS;

  return (
    <section className="lite-log" aria-label="Captain's log">
      <Button
        variant="ghost"
        className="lite-log__chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>Log</strong>
      </Button>
      {open && (
        <div className="lite-log__sheet">
          {!data && !error && <p className="muted">Loading…</p>}
          <ErrorNote error={error} />
          {data && missions.length === 0 && (
            <p className="muted">
              No missions logged yet. Missions appear here when crew open a PR or go home.
            </p>
          )}
          {missions.length > 0 && (
            <ul className="lite-log__list">
              {missions.map((m) => (
                <li key={m.id} className="lite-log__item">
                  <button
                    type="button"
                    className="lite-log__row"
                    aria-expanded={openId === m.id}
                    onClick={() => setOpenId(openId === m.id ? null : m.id)}
                  >
                    <span className="lite-log__who">
                      <strong>{m.name}</strong>
                      <RankChevrons title={m.rank?.title} />
                      <span className="muted">{endedAgo(Date.now() - m.endedAt)}</span>
                    </span>
                    <span className="lite-log__task">{m.task}</span>
                    <Badge variant={VERDICT_TONE[m.verdict.kind]} appearance="dot">
                      {m.verdict.line}
                    </Badge>
                  </button>
                  {openId === m.id && <LiteLogEntry deckId={deckId} missionId={m.id} />}
                </li>
              ))}
            </ul>
          )}
          {hasNextPage && (
            <Button
              size="sm"
              variant="ghost"
              className="lite-log__chip"
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Older
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** The call sign's service record on this deck, as a chip that opens it. */
function LiteRecord({ member }: { member: CrewInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="lite-record" aria-label="Service record">
      <Button
        variant="ghost"
        className="lite-record__chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <RankChevrons title={member.rank?.title} />
        <strong>{member.rank?.title ?? "Service record"}</strong>
      </Button>
      {open && <ServiceRecordWindow member={member} />}
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
      {member.inspection && <LiteInspection member={member} />}
      {member.kind === "agent" && <LiteRecord member={member} />}
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
  useInspectionNews(deckId, crew);
  useDebriefNews(deckId);

  return (
    <Toasty toastManager={toasts}>
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
                      {c.rank && (
                        <span className="lite-list__rank muted">
                          <RankChevrons title={c.rank.title} />
                          {c.rank.title}
                        </span>
                      )}
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
                      <ChipBadge chip={preflightChip(c.preflight)} />
                      <ChipBadge chip={inspectionChip(c.inspection)} />
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
            <section className="lite-deck" aria-label="Deck settings">
              <InspectorSwitch deckId={deckId} />
            </section>
            <LiteSmoke />
            <LiteLessons deckId={deckId} />
            <LiteLog deckId={deckId} />
            <HireForm deckId={deckId} crew={crew} />
          </>
        )}
      </main>
    </Toasty>
  );
}
