import { Button, InputArea } from "@cloudflare/kumo";
import { SentIcon } from "@hugeicons/core-free-icons";
import { useState, type ReactNode } from "react";
import { Icon } from "../../../shared/ui/Icon";

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
      className="game-form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <InputArea
        autoFocus
        aria-label={placeholder}
        autoResize
        minRows={4}
        maxRows={12}
        value={text}
        placeholder={placeholder}
        onValueChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {children}
      <footer className="modal__foot">
        <span className="muted">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </span>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!ready}
          icon={<Icon icon={SentIcon} />}
        >
          {submitLabel}
        </Button>
      </footer>
    </form>
  );
}
