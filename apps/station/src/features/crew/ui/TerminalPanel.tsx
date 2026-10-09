import { Badge } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";

/** xterm's colours, read from the Kumo theme so the terminal matches the windows around it. */
function themeOf(element: HTMLElement) {
  const css = getComputedStyle(element);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const background = token("--color-kumo-recessed");
  const brand = token("--color-kumo-brand");
  return {
    background,
    foreground: token("--text-color-kumo-default"),
    cursor: brand,
    cursorAccent: background,
    selectionBackground: `color-mix(in srgb, ${brand} 35%, transparent)`,
  };
}

/** Live crew terminal: snapshot on attach, then streamed output; typing goes to the agent. */
export function TerminalPanel({
  crewId,
  onStatus,
}: {
  crewId: string;
  /** "live", "exited", "reconnecting…" or what went wrong, for the window around it. */
  onStatus?: (status: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { client, state } = useRealtime();
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!client || state !== "open" || !element) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      // xterm touches the DOM, so it only ever loads in the browser.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (disposed) return;

      const term = new Terminal({
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
        theme: themeOf(element),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);

      const offMessage = client.onMessage((msg) => {
        if (msg.type === "error") {
          setError(msg.message);
          return;
        }
        if (!("crewId" in msg) || msg.crewId !== crewId) return;
        switch (msg.type) {
          case "terminal.snapshot":
            term.reset();
            term.write(msg.data);
            setExited(false);
            setError(null);
            return;
          case "terminal.output":
            term.write(msg.data);
            return;
          case "terminal.exit":
            term.write("\r\n\x1b[2m[crew process exited]\x1b[0m\r\n");
            setExited(true);
            return;
        }
      });
      const input = term.onData((data) => client.send({ type: "terminal.input", crewId, data }));

      let frame = 0;
      const fitToPanel = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          fit.fit();
          client.send({ type: "terminal.resize", crewId, cols: term.cols, rows: term.rows });
        });
      };
      const observer = new ResizeObserver(fitToPanel);

      client.send({ type: "terminal.attach", crewId });
      observer.observe(element);
      term.focus();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        input.dispose();
        offMessage();
        client.send({ type: "terminal.detach", crewId });
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [client, state, crewId]);

  const status = error ?? (state === "open" ? (exited ? "exited" : "live") : "reconnecting…");
  useEffect(() => onStatus?.(status), [onStatus, status]);

  return (
    <div className="terminal" data-exited={exited}>
      {error && (
        <div role="alert" className="terminal__error">
          <Badge variant="error">{error}</Badge>
        </div>
      )}
      <div ref={host} className="terminal__screen" aria-label="Crew terminal" />
    </div>
  );
}
