import { useState, type ReactNode } from "react";

/** agent-office's prompt box: Enter sends, Shift+Enter adds a line. */
export function TaskBox({
  placeholder,
  required,
  busy,
  submitLabel,
  onSubmit,
  children,
}: {
  placeholder: string;
  required: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (text: string) => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const ready = !busy && (!required || text.trim().length > 0);
  const send = () => ready && onSubmit(text.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        autoFocus
        rows={4}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {children}
      <footer className="modal__foot">
        <span className="muted">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="button" disabled={!ready}>
          {busy ? "Working…" : submitLabel}
        </button>
      </footer>
    </form>
  );
}
