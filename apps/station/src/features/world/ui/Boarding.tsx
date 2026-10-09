import { useState } from "react";

const TIPS = [
  "Walk up to an empty console and press E to hire crew",
  "P at a console hires crew with a task, or prompts the one sitting there",
  "N takes you to whoever is waiting on you",
  "A red beacon means a crew member needs your answer",
  "E at an occupied console opens its live terminal",
  "Hold Shift to run, drag to look around",
];

/** The screen while the deck loads: deck name, a docking bar and a controls tip. */
export function Boarding({ deck, progress }: { deck: string; progress?: number }) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]!);
  return (
    <div className="boarding" role="status" aria-live="polite">
      <p className="eyebrow">Docking at deck</p>
      <h1 className="boarding__deck">{deck}</h1>
      <div className="boarding__bar" data-indeterminate={progress === undefined || undefined}>
        <span style={progress === undefined ? undefined : { width: `${progress}%` }} />
      </div>
      <p className="boarding__tip">{tip}</p>
    </div>
  );
}
