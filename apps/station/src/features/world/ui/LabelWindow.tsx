import { Button, Input } from "@cloudflare/kumo";
import { Delete02Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import type { ConsoleLabel } from "@spaceship/protocol";
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
      icon={Tag01Icon}
      title={label ? `The sign over ${where}` : `Hang a sign over ${where}`}
      subtitle="Everyone on the deck sees it, and it stays up."
    >
      <form
        className="game-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) hang(text);
        }}
      >
        <Input
          autoFocus
          aria-label="Sign text"
          maxLength={MAX_LABEL}
          value={text}
          placeholder="What's this console for?"
          onChange={(e) => setText(e.target.value)}
          description={`${text.length}/${MAX_LABEL} characters`}
        />
        <div className="label-ideas">
          {LABEL_IDEAS.map((idea) => (
            <Button key={idea} size="xs" variant="outline" onClick={() => setText(idea)}>
              {idea}
            </Button>
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
        <ErrorNote error={save.error} />
        <footer className="modal__foot">
          {label ? (
            <Button
              variant="secondary-destructive"
              icon={<Icon icon={Delete02Icon} />}
              onClick={() => hang("")}
            >
              Take it down
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!text.trim()}
            icon={<Icon icon={Tag01Icon} />}
          >
            {label ? "Change it" : "Hang it"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
