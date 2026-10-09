import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useRealtime } from "../../shared/realtime/RealtimeProvider";

/** Station chrome: wordmark and the comms lamp. */
export function Shell({ children }: { children: ReactNode }) {
  const { state } = useRealtime();
  return (
    <div className="shell">
      <header className="shell__bar">
        <Link to="/" className="wordmark">
          <span className="wordmark__mark" aria-hidden />
          Mothership
        </Link>
        <span className="readout" data-testid="realtime-status">
          <span
            className="lamp"
            data-tone={state === "open" ? "go" : state === "connecting" ? "check" : "alert"}
          />
          Comms {state}
        </span>
      </header>
      {children}
    </div>
  );
}
