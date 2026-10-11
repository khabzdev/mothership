import { Button, Tooltip } from "@cloudflare/kumo";
import { Drawer } from "@cloudflare/kumo/primitives/drawer";
import {
  AirplaneTakeOff01Icon,
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  Cancel01Icon,
  ComputerTerminal01Icon,
  GitBranchIcon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import type { CrewInfo } from "@spaceship/protocol";
import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { TerminalPanel } from "../../crew/ui/TerminalPanel";
import { CONSOLES } from "../layout";
import { useWorld } from "../store";
import { StatusBadge } from "./StatusBadge";

const TALL_KEY = "spaceship.terminal.tall";

function readTall(): boolean {
  try {
    return localStorage.getItem(TALL_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A crew member's live terminal in a drawer that slides up from the bottom, so the deck (and the
 * crew member at its console) stays in view above it. Swipe it down, press Esc or ✕ to put it away;
 * the agent keeps running. Ctrl+[ sends Esc to the agent.
 */
export function TerminalDrawer({ member }: { member: CrewInfo }) {
  const { close, open } = useWorld.getState();
  const [tall, setTall] = useState(readTall);
  const [link, setLink] = useState("connecting…");
  const where = CONSOLES[member.consoleId]?.label ?? "";

  // Esc hides the terminal even while it has focus (xterm would eat it); Ctrl+[ still sends Esc
  // to the agent, as in agent-office.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);
  const toggleTall = () => {
    setTall(!tall);
    try {
      localStorage.setItem(TALL_KEY, tall ? "0" : "1");
    } catch {}
  };

  return (
    <Drawer.Root open modal={false} swipeDirection="down" onOpenChange={(o) => !o && close()}>
      <Drawer.Portal>
        <Drawer.Viewport className="term-drawer__viewport">
          <Drawer.Popup className="term-drawer" data-tall={tall || undefined}>
            <div className="term-drawer__grip" aria-hidden />
            <header className="term-drawer__head">
              <span className="dot" style={{ "--dot": member.color } as CSSProperties} />
              <div className="term-drawer__who">
                <Drawer.Title className="term-drawer__name">
                  <Icon icon={ComputerTerminal01Icon} />
                  {member.name}
                  <span className="term-drawer__kind">
                    {member.kind === "shell" ? "Shell" : "Claude Code"} · {where}
                  </span>
                </Drawer.Title>
                <Drawer.Description className="term-drawer__task">
                  {member.task.split("\n")[0] || "No task yet"}
                </Drawer.Description>
              </div>
              <StatusBadge crew={member} />
              <span className="term-drawer__link meta">{link}</span>
              <div className="term-drawer__actions">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Icon icon={Message01Icon} />}
                  onClick={() => open({ kind: "prompt", crewId: member.id })}
                >
                  Prompt
                </Button>
                {member.kind === "agent" && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Icon icon={GitBranchIcon} />}
                    onClick={() => open({ kind: "changes", crewId: member.id })}
                  >
                    Changes
                  </Button>
                )}
                {member.kind === "agent" && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Icon icon={AirplaneTakeOff01Icon} />}
                    onClick={() => open({ kind: "preflight", crewId: member.id })}
                  >
                    Pre-flight
                  </Button>
                )}
                <Tooltip content={tall ? "Shorter" : "Taller"}>
                  <Button
                    size="sm"
                    variant="ghost"
                    shape="square"
                    aria-label={tall ? "Make the terminal shorter" : "Make the terminal taller"}
                    icon={<Icon icon={tall ? ArrowShrink01Icon : ArrowExpand01Icon} />}
                    onClick={toggleTall}
                  />
                </Tooltip>
                <Drawer.Close
                  render={(props) => (
                    <Button
                      {...props}
                      size="sm"
                      variant="ghost"
                      shape="square"
                      aria-label="Hide the terminal (the agent keeps running)"
                      icon={<Icon icon={Cancel01Icon} />}
                    />
                  )}
                />
              </div>
            </header>
            <TerminalPanel crewId={member.id} onStatus={setLink} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
