import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useState } from "react";
import { chipFor } from "../scene/status";
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
        <span className="eyebrow">Crew</span>
        <span className="crew-panel__count">{crew.length || ""}</span>
        <span aria-hidden>{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <ul className="crew-panel__list">
          {list.map((c) => {
            const needs = c.status === "needs_input";
            const sub = [c.branch && `🌿 ${c.branch}`, c.prUrl && "🔀 PR", c.task.split("\n")[0]]
              .filter(Boolean)
              .join(" · ");
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
                  <span className="crew-panel__dot" style={{ background: c.color }} />
                  <span className="crew-panel__name">
                    {c.name}
                    {sub && <span className="crew-panel__sub">{sub}</span>}
                  </span>
                  <span className="crew-panel__pill">{chipFor(c)}</span>
                  {needs && (
                    <span className="crew-panel__ask">
                      🙋 {c.detail ?? "Waiting on an answer"}
                      {since && ` · ${since}`}
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
