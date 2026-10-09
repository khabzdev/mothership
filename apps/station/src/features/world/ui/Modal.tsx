import { useEffect, type ReactNode } from "react";
import { useWorld } from "../store";

/** A game window: Esc or the backdrop closes it, and game keys pause while it's open. */
export function Modal({
  title,
  subtitle,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const close = useWorld((s) => s.close);
  useEffect(() => {
    // Capture phase, so Esc closes even while the terminal has focus.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={wide ? "modal modal--wide" : "modal"} role="dialog" aria-label={title}>
        <header className="modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
