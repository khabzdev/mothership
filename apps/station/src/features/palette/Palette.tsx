import { CommandPalette } from "@cloudflare/kumo";
import {
  AirplaneTakeOff01Icon,
  ArrowUpDownIcon,
  ComputerTerminal01Icon,
  GitPullRequestIcon,
  Notification03Icon,
  Rocket01Icon,
  Search01Icon,
  SmartPhone01Icon,
  Target02Icon,
  TaskDaily01Icon,
  UserAdd01Icon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import type { ConsoleLabel, CrewInfo } from "@mothership/protocol";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconData } from "../../shared/ui/Icon";
import { decksQuery } from "../decks/queries";
import { boardQuery } from "../github/queries";
import { issueColumn } from "../github/model";
import { useDeckChoice } from "../world/deck-choice";
import { BOARDS, CONSOLES, FLIGHT_CONTROL, type BoardId } from "../world/layout";
import { captain, jumpTo } from "../world/scene/Captain";
import { useWorld } from "../world/store";
import { waitingInOrder } from "../world/waiting";
import { rank } from "./match";

interface Entry {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconData;
  /** Do it; with `walk`, go there first (agent-office's Shift+Enter). */
  run: (walk: boolean) => void;
}

interface Group {
  id: string;
  label: string;
  items: Entry[];
}

/** Stand in front of a board, facing it. */
function goToBoard(board: BoardId): void {
  const b = BOARDS[board];
  Object.assign(captain, { x: b.x, z: b.z + 1.6, facing: Math.PI, snap: true });
}

/** Stand at the Flight Control desk, facing it. */
function goToFlightControl(): void {
  Object.assign(captain, { x: FLIGHT_CONTROL.x, z: FLIGHT_CONTROL.z - 1.4, facing: 0, snap: true });
}

/**
 * agent-office's command palette (Ctrl+K / ⌘K): find anything on the deck by typing a few letters.
 * Enter opens it the way clicking it in the world does; Shift+Enter takes you there first.
 */
export function Palette({
  deckId,
  crew,
  labels,
}: {
  deckId: string;
  crew: CrewInfo[];
  labels: ConsoleLabel[];
}) {
  const open = useWorld((s) => s.paletteOpen);
  const setOpen = useWorld((s) => s.setPalette);
  const [query, setQuery] = useState("");
  const shift = useRef(false);
  const { data: github } = useQuery(boardQuery(deckId));
  const { data: decks } = useSuspenseQuery(decksQuery);
  const { choose } = useDeckChoice();

  // Ctrl+K / ⌘K opens and closes it, anywhere but a terminal or a text box (where it's their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey)) return;
      // Keys sent to the window or document (not an element) count as on the deck.
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing =
        target?.closest(".xterm") ||
        (target &&
          /^(INPUT|TEXTAREA)$/.test(target.tagName) &&
          !target.closest(".kumo-command-palette, [data-palette]"));
      if (typing) return;
      e.preventDefault();
      setOpen(!useWorld.getState().paletteOpen);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setOpen]);

  // Which Enter it was: Shift walks you there first.
  useEffect(() => {
    if (!open) return;
    const track = (e: KeyboardEvent) => {
      if (e.key === "Enter") shift.current = e.shiftKey;
    };
    window.addEventListener("keydown", track, true);
    return () => window.removeEventListener("keydown", track, true);
  }, [open]);

  const groups = useMemo<Group[]>(() => {
    const world = useWorld.getState();
    const openOverlay = world.open;
    const sign = (id: number) => labels.find((l) => l.consoleId === id)?.text;
    const free = CONSOLES.find((c) => !crew.some((m) => m.consoleId === c.id));
    const waiting = waitingInOrder(crew)[0];

    const nogo = crew.find((m) => m.preflight?.state === "nogo");
    const actions: Entry[] = [
      ...(waiting
        ? [
            {
              id: "a:next",
              title: `Go to ${waiting.name}, waiting on you`,
              subtitle: waiting.detail ?? waiting.task.split("\n")[0],
              icon: Notification03Icon,
              run: () => {
                jumpTo(waiting.consoleId);
                openOverlay({ kind: "terminal", crewId: waiting.id });
              },
            },
          ]
        : []),
      ...(nogo
        ? [
            {
              id: "a:nogo",
              title: "Crew with NO-GO",
              subtitle: `${nogo.name}'s pre-flight failed`,
              icon: AirplaneTakeOff01Icon,
              run: (walk: boolean) => {
                if (walk) jumpTo(nogo.consoleId);
                openOverlay({ kind: "preflight", crewId: nogo.id });
              },
            },
          ]
        : []),
      ...(free
        ? [
            {
              id: "a:hire",
              title: "Hire crew",
              subtitle: `At ${free.label}, the next free console`,
              icon: UserAdd01Icon,
              run: (walk: boolean) => {
                if (walk) jumpTo(free.id);
                openOverlay({ kind: "hire", consoleId: free.id, withTask: true });
              },
            },
          ]
        : []),
      {
        id: "a:search",
        title: "Search the terminals",
        subtitle: "Every crew terminal on this deck (/)",
        icon: Search01Icon,
        run: () => openOverlay({ kind: "search" }),
      },
      {
        id: "a:lite",
        title: "Open the 2D view",
        subtitle: "/lite: the deck as a plain list, for a phone or a slow machine",
        icon: SmartPhone01Icon,
        run: () => window.location.assign("/lite"),
      },
      {
        id: "a:lift",
        title: "Ride the lift",
        subtitle: "Another deck, or add one",
        icon: ArrowUpDownIcon,
        run: () => openOverlay({ kind: "lift" }),
      },
    ];

    const boards: Entry[] = (
      [
        ["mission", "Mission board", "GitHub issues", Target02Icon],
        ["launch", "Launch board", "Pull requests", Rocket01Icon],
        ["queue", "Task queue", "Tasks waiting for crew", TaskDaily01Icon],
      ] as const
    ).map(([board, title, subtitle, icon]): Entry => ({
      id: `b:${board}`,
      title,
      subtitle,
      icon,
      run: (walk) => {
        if (walk) goToBoard(board);
        openOverlay({ kind: "board", board });
      },
    }));
    boards.push({
      id: "b:flightControl",
      title: "Flight Control",
      subtitle: "The deck's pre-flight checks",
      icon: AirplaneTakeOff01Icon,
      run: (walk) => {
        if (walk) goToFlightControl();
        openOverlay({ kind: "flightControl" });
      },
    });

    const people: Entry[] = crew.map((m) => ({
      id: `c:${m.id}`,
      title: m.name,
      subtitle: `${CONSOLES[m.consoleId]?.label ?? ""}${sign(m.consoleId) ? ` · ${sign(m.consoleId)}` : ""} · ${m.task.split("\n")[0] || (m.kind === "shell" ? "Shell" : "No task")}`,
      icon: ComputerTerminal01Icon,
      run: (walk) => {
        if (walk) jumpTo(m.consoleId);
        openOverlay({ kind: "terminal", crewId: m.id });
      },
    }));

    const flights: Entry[] = crew
      .filter((m) => m.kind === "agent")
      .map((m) => ({
        id: `f:${m.id}`,
        title: `Pre-flight ${m.name}`,
        subtitle: "Checks run when it stops",
        icon: AirplaneTakeOff01Icon,
        run: (walk) => {
          if (walk) jumpTo(m.consoleId);
          openOverlay({ kind: "preflight", crewId: m.id });
        },
      }));

    const consoles: Entry[] = CONSOLES.map((c) => {
      const m = crew.find((x) => x.consoleId === c.id);
      return {
        id: `k:${c.id}`,
        title: `${c.label}${sign(c.id) ? ` · ${sign(c.id)}` : ""}`,
        subtitle: m ? m.name : "Empty",
        icon: WorkflowSquare03Icon,
        run: () => jumpTo(c.id),
      };
    });

    const issues: Entry[] = (github?.issues ?? [])
      .filter((i) => issueColumn(i) !== "closed")
      .map((i) => ({
        id: `i:${i.number}`,
        title: `#${i.number} ${i.title}`,
        subtitle: issueColumn(i) === "progress" ? "In progress" : "Open issue",
        icon: Target02Icon,
        run: (walk) => {
          if (walk) goToBoard("mission");
          openOverlay({ kind: "board", board: "mission", open: i.number });
        },
      }));

    const pulls: Entry[] = (github?.pulls ?? [])
      .filter((p) => p.state === "OPEN")
      .map((p) => ({
        id: `p:${p.number}`,
        title: `#${p.number} ${p.title}`,
        subtitle: `Pull request · ${p.headRefName}`,
        icon: GitPullRequestIcon,
        run: (walk) => {
          if (walk) goToBoard("launch");
          openOverlay({ kind: "board", board: "launch", open: p.number });
        },
      }));

    const otherDecks: Entry[] = decks
      .filter((d) => d.id !== deckId)
      .map((d) => ({
        id: `d:${d.id}`,
        title: `Deck ${d.name}`,
        subtitle: d.repoPath,
        icon: ArrowUpDownIcon,
        run: () => choose(d.id),
      }));

    const groups: Group[] = [
      { id: "actions", label: "Actions", items: actions },
      { id: "crew", label: "Crew", items: people },
      { id: "flights", label: "Pre-flight", items: flights },
      { id: "boards", label: "Boards", items: boards },
      { id: "issues", label: "Issues", items: issues },
      { id: "pulls", label: "Pull requests", items: pulls },
      { id: "consoles", label: "Consoles", items: consoles },
      { id: "decks", label: "Decks", items: otherDecks },
    ];
    // Ranked within each group, the groups in order; with no query, consoles and issues wait.
    return groups
      .map((g) => ({
        ...g,
        items: query.trim()
          ? rank(query, g.items, (e) => [e.title, e.subtitle])
          : ["consoles", "issues", "pulls"].includes(g.id)
            ? []
            : g.items,
      }))
      .filter((g) => g.items.length);
  }, [query, crew, labels, github, decks, deckId, choose]);

  const select = (entry: Entry) => {
    const walk = shift.current;
    shift.current = false;
    setOpen(false);
    setQuery("");
    useWorld.getState().close();
    entry.run(walk);
  };

  return (
    <CommandPalette.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
      items={groups}
      value={query}
      onValueChange={setQuery}
      itemToStringValue={(g: Group) => g.label}
      filter={() => true}
      onSelect={(item: Entry) => select(item)}
      getSelectableItems={(gs: Group[]) => gs.flatMap((g) => g.items)}
    >
      <CommandPalette.Input placeholder="Find crew, issues, PRs, boards, consoles, actions…" />
      <CommandPalette.List>
        <CommandPalette.Results>
          {(group: Group) => (
            <CommandPalette.Group key={group.id} items={group.items}>
              <CommandPalette.GroupLabel>{group.label}</CommandPalette.GroupLabel>
              <CommandPalette.Items>
                {(item: Entry) => (
                  <CommandPalette.Item key={item.id} value={item} onClick={() => select(item)}>
                    <span className="palette-item">
                      <Icon icon={item.icon} />
                      <span className="palette-item__title">{item.title}</span>
                      {item.subtitle && <span className="palette-item__sub">{item.subtitle}</span>}
                    </span>
                  </CommandPalette.Item>
                )}
              </CommandPalette.Items>
            </CommandPalette.Group>
          )}
        </CommandPalette.Results>
        <CommandPalette.Empty>Nothing on this deck matches</CommandPalette.Empty>
      </CommandPalette.List>
      <CommandPalette.Footer>
        <span className="palette-keys">
          <kbd>↑↓</kbd> choose <kbd>↵</kbd> open <kbd>⇧↵</kbd> go there first <kbd>esc</kbd> close
        </span>
      </CommandPalette.Footer>
    </CommandPalette.Root>
  );
}
