import type { CrewInfo } from "@mothership/protocol";
import { Badge } from "@cloudflare/kumo";
import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  Notification03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../../shared/ui/Icon";
import { inspectionChip } from "../../inspection/model";
import { PatchIcons } from "../../ranks/ui/PatchIcons";
import { RankChevrons } from "../../ranks/ui/RankChevrons";
import { StatusBadge } from "./StatusBadge";
import { needyFirst, waited } from "../waiting";

const COLLAPSED_KEY = "mothership.crewPanel.collapsed";

/**
 * agent-office's Workers panel: every crew member on the deck and what it's on. One that needs you
 * goes to the top, in red, saying what it's asking and for how long. A click takes you there with
 * its terminal open.
 */
export function CrewPanel({ crew, open }: { crew: CrewInfo[]; open: (member: CrewInfo) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {}
  };
  const list = needyFirst(crew);
  const asking = list.some((c) => c.status === "needs_input");

  return (
    <aside className="crew-panel" data-asking={asking || undefined}>
      <button
        type="button"
        className="crew-panel__head"
        onClick={toggle}
        aria-expanded={!collapsed}
      >
        <span className="section-label with-icon">
          <Icon icon={UserGroupIcon} size={12} /> Crew
        </span>
        <span className="crew-panel__count">{crew.length || ""}</span>
        <Icon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} size={14} />
      </button>
      {!collapsed && (
        <ul className="crew-panel__list">
          {list.map((c) => {
            const needs = c.status === "needs_input";
            const sub = c.task.split("\n")[0];
            const since = waited(c.statusSince, now);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  data-status={c.status}
                  onClick={() => open(c)}
                  title={
                    needs
                      ? `${c.name} needs you: open its terminal to answer`
                      : `Open ${c.name}'s terminal`
                  }
                >
                  <span className="dot" style={{ "--dot": c.color } as CSSProperties} />
                  <span className="crew-panel__name">
                    {c.name}
                    {c.rank && (
                      <span className="crew-panel__sub crew-panel__rank with-icon">
                        <RankChevrons title={c.rank.title} />
                        {c.rank.title}
                        <PatchIcons patches={c.patches} size={12} />
                      </span>
                    )}
                    {(c.branch || c.prUrl) && (
                      <span className="crew-panel__sub with-icon">
                        {c.branch && <Icon icon={GitBranchIcon} size={12} />}
                        {c.branch}
                        {c.prUrl && <Icon icon={GitPullRequestIcon} size={12} />}
                      </span>
                    )}
                    {sub && <span className="crew-panel__sub">{sub}</span>}
                  </span>
                  <span className="crew-panel__badges">
                    <StatusBadge crew={c} />
                    <InspectionChip info={c.inspection} />
                  </span>
                  {needs && (
                    <span className="crew-panel__ask">
                      <Icon icon={Notification03Icon} size={12} />
                      <span>
                        {c.detail ?? "Waiting on an answer"}
                        {since && ` · ${since}`}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!list.length && (
            <li className="crew-panel__empty">Walk up to a console and press E to hire crew</li>
          )}
        </ul>
      )}
    </aside>
  );
}

function InspectionChip({ info }: { info?: CrewInfo["inspection"] }) {
  const chip = inspectionChip(info);
  return (
    chip && (
      <Badge variant={chip.tone} appearance="dot">
        {chip.label}
      </Badge>
    )
  );
}
