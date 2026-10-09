import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useRef, useState } from "react";
import { playDone, playNeedsYou } from "../sound";
import { Fresh, bannerText, needingYou } from "../waiting";

/**
 * agent-office's needs-you banner under the top bar: who, what it's asking and for how long, a click
 * (or N) away. The screen's edge flashes red and the alarm rings when one starts asking.
 */
export function NeedsYouBanner({ crew, go }: { crew: CrewInfo[]; go: (id: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState(0);
  /** The waits the banner was put away on: it comes back for anyone else, or a new wait. */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const fresh = useRef(new Fresh());
  const asking = needingYou(crew);

  useEffect(() => {
    const changed = fresh.current.take(crew);
    if (changed.some((c) => c.status === "needs_input")) {
      setFlash((n) => n + 1);
      playNeedsYou();
    } else if (changed.some((c) => c.status === "done")) {
      playDone();
    }
  }, [crew]);

  useEffect(() => {
    if (!asking.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [asking.length]);

  const waitKey = (c: CrewInfo) => `${c.id}@${c.statusSince}`;
  const text = bannerText(
    asking.filter((c) => !hidden.has(waitKey(c))),
    now,
  );

  return (
    <>
      {text && (
        <div className="needs-you" role="status" aria-live="polite" key={text.id}>
          <button
            type="button"
            className="needs-you__go"
            title={`Go to ${text.title.replace(/ needs you$/, "")}'s console (N)`}
            onClick={() => go(text.id)}
          >
            <span className="needs-you__icon" aria-hidden>
              🙋
            </span>
            <span className="needs-you__text">
              <strong>{text.title}</strong>
              {text.detail && <span>{text.detail}</span>}
            </span>
            {text.more && <span className="needs-you__more">{text.more}</span>}
            <kbd>N</kbd>
          </button>
          <button
            type="button"
            className="needs-you__x"
            aria-label="Hide"
            title="Hide until another crew member needs you"
            onClick={() => setHidden(new Set(asking.map(waitKey)))}
          >
            ✕
          </button>
        </div>
      )}
      {flash > 0 && <div key={flash} className="needs-you-flash" aria-hidden />}
    </>
  );
}

/** agent-office's toast: a line over the hint bar that fades after a few seconds. */
export function Toast({ toast }: { toast: { text: string; at: number } | null }) {
  if (!toast) return null;
  return (
    <div key={toast.at} className="toast" role="status">
      {toast.text}
    </div>
  );
}
