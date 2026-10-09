import { useEffect, useRef, useState } from "react";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";

const THEME = {
  background: "#0b0a08",
  foreground: "#ece6d6",
  cursor: "#ff5f1f",
  cursorAccent: "#0b0a08",
  selectionBackground: "#ff5f1f55",
};

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
        fontFamily: '"Martian Mono", ui-monospace, monospace',
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
        theme: THEME,
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
        <p role="alert" className="terminal__error">
          {error}
        </p>
      )}
      <div ref={host} className="terminal__screen" aria-label="Crew terminal" />
    </div>
  );
}
