import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { crewBlocker } from "../diagnostics";
import { getDiagnostics } from "../diagnostics.functions";
import { diagnosticsQuery } from "../queries";

const TONE = { ok: "go", missing: "alert", unauthenticated: "check", error: "alert" } as const;

/** Bridge panel: are claude, gh, git and the PTY host ready? */
export function StationChecks() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(diagnosticsQuery);
  const [refreshing, setRefreshing] = useState(false);
  const blocker = crewBlocker(data);

  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(
        diagnosticsQuery.queryKey,
        await getDiagnostics({ data: { refresh: true } }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="panel" aria-label="Station checks">
      <h2 className="stencil">Station checks</h2>
      {blocker ? (
        <p role="alert" className="error">
          {blocker}
        </p>
      ) : (
        <p className="readout">
          Crew ready{data.airlockReady ? " · airlock ready" : " · airlock offline"}
        </p>
      )}
      <ul className="checks">
        {data.checks.map((check) => (
          <li key={check.id} data-status={check.status}>
            <span className="lamp" data-tone={TONE[check.status]} />
            <span className="checks__label">{check.label}</span>
            <span className="checks__detail">{check.detail}</span>
            {check.fix && check.status !== "ok" && <code className="checks__fix">{check.fix}</code>}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button--ghost"
        onClick={refresh}
        disabled={refreshing}
      >
        {refreshing ? "Checking…" : "Re-check"}
      </button>
    </section>
  );
}
