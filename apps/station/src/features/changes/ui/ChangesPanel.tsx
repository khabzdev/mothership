import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { STATUS_WORD, type ChangedFile } from "../model";
import { changesQuery, commitMutation, diffQuery, discardMutation } from "../queries";

interface DiffLine {
  kind: "ctx" | "add" | "del" | "hunk" | "meta";
  old: string;
  now: string;
  code: string;
}

/** A unified diff as numbered lines, file headers left out (agent-office's renderDiff). */
export function diffLines(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      inHunk = true;
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) [oldN, newN] = [Number(m[1]), Number(m[2])];
      out.push({ kind: "hunk", old: "", now: "", code: raw });
    } else if (!inHunk || raw.startsWith("diff --git")) {
      inHunk = false;
      if (
        /^(diff --git|index |--- |\+\+\+ |similarity index|new file mode|deleted file mode)/.test(
          raw,
        )
      )
        continue;
      out.push({ kind: "meta", old: "", now: "", code: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", old: "", now: String(newN++), code: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", old: String(oldN++), now: "", code: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      out.push({ kind: "meta", old: "", now: "", code: raw });
    } else {
      out.push({ kind: "ctx", old: String(oldN++), now: String(newN++), code: raw.slice(1) });
    }
  }
  return out;
}

function Diff({ crewId, file }: { crewId: string; file: ChangedFile }) {
  const diff = useQuery(diffQuery(crewId, file.path));
  if (file.binary) return <p className="changes__note">Binary file: no diff to show.</p>;
  if (diff.isPending) return <p className="changes__note">Loading the diff…</p>;
  if (diff.error) return <p className="changes__note error">{diff.error.message}</p>;
  const lines = diffLines(diff.data.diff);
  if (!lines.length) return <p className="changes__note">No line changes.</p>;
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={i} className="diff__line" data-kind={l.kind}>
          <span className="diff__ln">{l.old}</span>
          <span className="diff__ln">{l.now}</span>
          <span className="diff__code">{l.code}</span>
        </div>
      ))}
      {diff.data.truncated && (
        <div className="diff__line" data-kind="meta">
          <span className="diff__ln" />
          <span className="diff__ln" />
          <span className="diff__code">… the rest of this diff is too long to show here</span>
        </div>
      )}
    </div>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * agent-office's Changes window: the files a crew member changed and their diff, refreshed while
 * it works, with commit and discard.
 */
export function ChangesPanel({
  crewId,
  task,
  onTerminal,
}: {
  crewId: string;
  task: string;
  onTerminal: () => void;
}) {
  const queryClient = useQueryClient();
  const changes = useQuery(changesQuery(crewId));
  const commit = useMutation(commitMutation(queryClient, crewId));
  const discard = useMutation(discardMutation(queryClient, crewId));
  const [selected, setSelected] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState(() => task.split("\n")[0]?.slice(0, 72) ?? "");
  const [confirming, setConfirming] = useState<"all" | "file" | null>(null);

  const state = changes.data;
  const files = state?.files ?? [];
  const file = files.find((f) => f.path === selected) ?? files[0];
  const uncommitted = files.filter((f) => f.uncommitted).length;
  const error = changes.error ?? commit.error ?? discard.error;

  useEffect(() => setConfirming(null), [file?.path]);

  return (
    <div className="changes">
      <div className="changes__bar">
        <span className="changes__branch">
          🌿 {state?.branch ?? "…"}
          {state && state.base !== "HEAD" && (
            <span className="muted">
              {" "}
              ·{" "}
              {state.ahead
                ? `${plural(state.ahead, "commit")}, last: ${state.subject}`
                : "no commits yet"}
            </span>
          )}
        </span>
        <button type="button" className="button button--ghost" onClick={onTerminal}>
          ⌨️ Terminal
        </button>
      </div>

      <div className="changes__body">
        <aside className="changes__files">
          <h4 className="eyebrow">Changed files{files.length ? ` · ${files.length}` : ""}</h4>
          <ul role="listbox" aria-label="Changed files">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={f === file}
                  onClick={() => setSelected(f.path)}
                  title={`${f.path}: ${STATUS_WORD[f.status]}${f.uncommitted ? ", not committed" : ""}`}
                >
                  <span className="changes__status" data-status={f.status}>
                    {f.status}
                  </span>
                  <span className="changes__path">
                    {f.path.includes("/") && (
                      <span className="muted">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span>
                    )}
                    {fileName(f.path)}
                  </span>
                  <span className="changes__pm">
                    {f.binary ? (
                      "bin"
                    ) : (
                      <>
                        <span className="add">+{f.additions}</span>{" "}
                        <span className="del">−{f.deletions}</span>
                      </>
                    )}
                  </span>
                  {f.uncommitted && <span className="changes__dot" title="Not committed" />}
                </button>
              </li>
            ))}
            {state && !files.length && <li className="changes__note">Nothing changed yet.</li>}
            {state && state.more > 0 && <li className="changes__note">…and {state.more} more</li>}
          </ul>
        </aside>
        <section className="changes__diff">
          {file ? (
            <>
              <header className="changes__diffhead">
                <strong>{file.from ? `${file.from} → ${file.path}` : file.path}</strong>
                <span className="muted">{STATUS_WORD[file.status]}</span>
                {file.uncommitted &&
                  (confirming === "file" ? (
                    <span className="changes__confirm">
                      Put it back to the last commit?
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() =>
                          discard.mutate(file.path, { onSuccess: () => setConfirming(null) })
                        }
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="button button--ghost"
                      title="Throw away the uncommitted changes to this file"
                      onClick={() => setConfirming("file")}
                    >
                      ↩︎ Discard
                    </button>
                  ))}
              </header>
              <Diff crewId={crewId} file={file} />
            </>
          ) : (
            <p className="changes__note">
              {changes.isPending ? "Looking at the checkout…" : "Pick a file."}
            </p>
          )}
        </section>
      </div>

      {error && (
        <p role="alert" className="error">
          {error.message}
        </p>
      )}

      <footer className="modal__foot">
        {confirming === "all" ? (
          <span className="changes__confirm">
            Put {plural(uncommitted, "file")} back to the last commit and delete new files? Commits
            stay.
            <button
              type="button"
              className="button button--danger"
              onClick={() => discard.mutate(undefined, { onSuccess: () => setConfirming(null) })}
            >
              Discard everything
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setConfirming(null)}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button button--ghost"
            disabled={!uncommitted || discard.isPending}
            onClick={() => setConfirming("all")}
          >
            🗑️ Discard all
          </button>
        )}
        {committing ? (
          <form
            className="changes__commit"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim())
                commit.mutate(message.trim(), { onSuccess: () => setCommitting(false) });
            }}
          >
            <input
              autoFocus
              value={message}
              placeholder="Commit message"
              onChange={(e) => setMessage(e.target.value)}
            />
            <button type="submit" className="button" disabled={!message.trim() || commit.isPending}>
              {commit.isPending ? "Committing…" : "Commit"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!uncommitted}
            title="git add -A && git commit"
            onClick={() => setCommitting(true)}
          >
            ✅ {uncommitted ? `Commit ${plural(uncommitted, "file")}…` : "Commit…"}
          </button>
        )}
      </footer>
    </div>
  );
}
