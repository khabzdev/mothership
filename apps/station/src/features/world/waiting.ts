import type { CrewInfo, CrewStatus } from "@mothership/protocol";

// Who's waiting on you, in what order, and what the needs-you banner says about them: agent-office's
// nextup.ts and needsyou/logic.ts. No three.js and no DOM, so the tests run it as it is.

type Waiting = CrewInfo & { status: "needs_input" | "done" };

/** Stopped on a question or a permission, or finished its turn. */
export const waitingOnYou = (c: CrewInfo): c is Waiting =>
  c.status === "needs_input" || c.status === "done";

/** The ones that need you first (they can't go on until you answer), then the done; longest wait first. */
export function waitingInOrder(crew: Iterable<CrewInfo>): Waiting[] {
  const blocked = (c: CrewInfo) => (c.status === "needs_input" ? 0 : 1);
  return [...crew]
    .filter(waitingOnYou)
    .sort(
      (a, b) =>
        blocked(a) - blocked(b) || a.statusSince - b.statusSince || a.consoleId - b.consoleId,
    );
}

/** Crew stopped until you answer them, longest wait first. */
export function needingYou(crew: Iterable<CrewInfo>): Waiting[] {
  return waitingInOrder(crew).filter((c) => c.status === "needs_input");
}

/** The Crew panel's order: the ones that need you on top (longest first), then by console. */
export function needyFirst(crew: Iterable<CrewInfo>): CrewInfo[] {
  const all = [...crew];
  return [
    ...needingYou(all),
    ...all.filter((c) => c.status !== "needs_input").sort((a, b) => a.consoleId - b.consoleId),
  ];
}

/** How long it has waited, for the banner: nothing for the first minute, then "4 min", "1 h 05 min". */
export function waited(since: number, now: number): string {
  const min = Math.floor((now - since) / 60_000);
  if (min < 1) return "";
  return min < 60
    ? `${min} min`
    : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export interface BannerText {
  /** The crew member it takes you to: whoever has waited longest. */
  id: string;
  title: string;
  /** What it's asking, and for how long. */
  detail: string;
  /** How many more are asking, or "". */
  more: string;
  /** Changes whenever the banner would read differently. */
  key: string;
}

/** What the banner says about `asking` (longest first, see needingYou), or null with nobody to show. */
export function bannerText(asking: readonly CrewInfo[], now: number): BannerText | null {
  const c = asking[0];
  if (!c) return null;
  const ask = (c.detail ?? c.task).replace(/\s+/g, " ").trim();
  const detail = [ask.length > 90 ? `${ask.slice(0, 89)}…` : ask, waited(c.statusSince, now)]
    .filter(Boolean)
    .join(" · ");
  const more = asking.length > 1 ? `+${asking.length - 1} more` : "";
  const title = `${c.name} needs you`;
  return { id: c.id, title, detail, more, key: `${c.id}|${title}|${detail}|${more}` };
}

/** Tells crew that have just started waiting from ones that were waiting when the page first saw them. */
export class Fresh {
  #last = new Map<string, CrewStatus>();

  /** The crew whose status just changed to one of `statuses`. */
  take(crew: readonly CrewInfo[]): CrewInfo[] {
    const out: CrewInfo[] = [];
    for (const c of crew) {
      const before = this.#last.get(c.id);
      this.#last.set(c.id, c.status);
      if (before !== undefined && before !== c.status) out.push(c);
    }
    for (const id of this.#last.keys()) if (!crew.some((c) => c.id === id)) this.#last.delete(id);
    return out;
  }
}

/**
 * One press of N after another: the first crew member in line you haven't been to yet this round,
 * then the first again. One that starts waiting again after you've been to it is new to this round.
 */
export class NextUp {
  #visited = new Map<string, number>();

  /** The one to go to next. `here` is the one you're standing at: it only comes up if it's the only one. */
  next(crew: Iterable<CrewInfo>, here?: string): Waiting | undefined {
    const waiting = waitingInOrder(crew);
    for (const [id, at] of this.#visited) {
      if (!waiting.some((c) => c.id === id && c.statusSince === at)) this.#visited.delete(id);
    }
    const others = waiting.filter((c) => c.id !== here);
    let pick = others.find((c) => !this.#visited.has(c.id));
    if (!pick) {
      this.#visited.clear();
      pick = others[0] ?? waiting[0];
    }
    if (pick) this.#visited.set(pick.id, pick.statusSince);
    return pick;
  }
}

/**
 * Every crew member as the 2D view lists them (agent-office's byUrgency): the ones waiting on you
 * first, then the ones at work, then the rest, asleep last; by console within each.
 */
export function byUrgency(crew: Iterable<CrewInfo>): CrewInfo[] {
  const all = [...crew];
  const rank = (c: CrewInfo) =>
    c.status === "working" || c.status === "starting" ? 0 : c.status === "asleep" ? 2 : 1;
  const rest = all
    .filter((c) => !waitingOnYou(c))
    .sort((a, b) => rank(a) - rank(b) || a.consoleId - b.consoleId);
  return [...waitingInOrder(all), ...rest];
}
