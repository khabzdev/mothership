import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { crewBlocker } from "../diagnostics";
import { getDiagnostics } from "../diagnostics.functions";
import { diagnosticsQuery } from "../queries";

const ICON = { ok: "✓", missing: "✗", unauthenticated: "!", error: "✗" } as const;

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
    <section aria-label="Station checks">
      <h2>Station checks</h2>
      {blocker ? (
        <p role="alert">{blocker}</p>
      ) : (
        <p>Crew ready{data.airlockReady ? " · airlock ready" : ""}</p>
      )}
      <ul>
        {data.checks.map((check) => (
          <li key={check.id} data-status={check.status}>
            {ICON[check.status]} <strong>{check.label}</strong>
            {check.detail && <> · {check.detail}</>}
            {check.fix && check.status !== "ok" && (
              <>
                {" "}
                · <code>{check.fix}</code>
              </>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={refresh} disabled={refreshing}>
        {refreshing ? "Checking…" : "Re-check"}
      </button>
    </section>
  );
}
