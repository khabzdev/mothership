import type { ConsoleLabel } from "@mothership/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LABEL_IDEAS, MAX_LABEL, SIGN_COLORS } from "../../labels/model";
import { setLabelMutation } from "../../labels/queries";
import { CONSOLES } from "../layout";
import { useWorld } from "../store";
import { Modal } from "./Modal";

/** agent-office's sign window: up to 32 characters (or an idea), one of seven colours, Enter. */
export function LabelWindow({
  deckId,
  consoleId,
  label,
}: {
  deckId: string;
  consoleId: number;
  label?: ConsoleLabel;
}) {
  const queryClient = useQueryClient();
  const close = useWorld((s) => s.close);
  const save = useMutation(setLabelMutation(queryClient));
  const [text, setText] = useState(label?.text ?? "");
  const [color, setColor] = useState(label?.color ?? SIGN_COLORS[0].color);
  const where = CONSOLES[consoleId]?.label ?? `Console ${consoleId + 1}`;
  const hang = (value: string) =>
    save.mutate({ deckId, consoleId, text: value.trim(), color }, { onSuccess: close });

  return (
    <Modal
      title={label ? `🪧 The sign over ${where}` : `🪧 Hang a sign over ${where}`}
      subtitle="Everyone on the deck sees it, and it stays up."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) hang(text);
        }}
      >
        <input
          autoFocus
          maxLength={MAX_LABEL}
          value={text}
          placeholder="What's this console for?"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="label-ideas">
          {LABEL_IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => setText(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <div className="label-colors" role="radiogroup" aria-label="Colour">
          {SIGN_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              role="radio"
              aria-checked={c.color === color}
              aria-label={c.name}
              title={c.name}
              className="swatch"
              style={{ background: c.color }}
              onClick={() => setColor(c.color)}
            />
          ))}
        </div>
        {save.error && (
          <p role="alert" className="error">
            {save.error.message}
          </p>
        )}
        <footer className="modal__foot">
          {label ? (
            <button type="button" className="button button--ghost" onClick={() => hang("")}>
              Take it down
            </button>
          ) : (
            <span className="muted">
              {text.length}/{MAX_LABEL}
            </span>
          )}
          <button type="submit" className="button" disabled={!text.trim() || save.isPending}>
            {label ? "Change it" : "Hang it"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
