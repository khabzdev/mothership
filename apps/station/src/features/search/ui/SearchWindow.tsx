import { Empty, Input, Loader } from "@cloudflare/kumo";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { useWorld } from "../../world/store";
import { searchTerminals } from "../search.functions";

/** Highlight every word of the query in a line. */
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** agent-office's / search, over every crew terminal on the deck: click a line to open that terminal. */
export function SearchWindow({ deckId }: { deckId: string }) {
  const open = useWorld((s) => s.open);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ["decks", deckId, "search", query],
    queryFn: () => searchTerminals({ data: { deckId, query } }),
    enabled: query.length > 1,
  });
  const hits = results.data ?? [];
  const byCrew = [...new Set(hits.map((h) => h.crewId))].map((crewId) => ({
    crewId,
    name: hits.find((h) => h.crewId === crewId)!.name,
    lines: hits.filter((h) => h.crewId === crewId),
  }));

  return (
    <div className="search">
      <Input
        autoFocus
        aria-label="Search the terminals"
        placeholder="Words to find, e.g. error npm test"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ErrorNote error={results.error} />
      <div className="search__results">
        {results.isFetching && (
          <p className="board__empty">
            <Loader size="sm" /> Searching…
          </p>
        )}
        {query.length > 1 && results.isSuccess && !hits.length && (
          <Empty
            size="sm"
            icon={<Icon icon={Search01Icon} size={24} />}
            title="No matches"
            description={`No terminal on this deck has “${query}”.`}
          />
        )}
        {byCrew.map((group) => (
          <section key={group.crewId} className="search__group">
            <h4 className="section-label">
              {group.name} · {group.lines.length}
            </h4>
            {group.lines.map((hit) => (
              <button
                key={`${hit.crewId}:${hit.line}`}
                type="button"
                className="search__hit"
                onClick={() => open({ kind: "terminal", crewId: hit.crewId })}
              >
                <span className="search__line">{hit.line + 1}</span>
                <span className="search__text">
                  <Marked text={hit.text} query={query} />
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
