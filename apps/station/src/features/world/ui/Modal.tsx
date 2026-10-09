import { Button, Dialog } from "@cloudflare/kumo";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Icon, type IconData } from "../../../shared/ui/Icon";
import { useWorld } from "../store";

/**
 * A game window on Kumo's Dialog: Esc or the backdrop closes it, and game keys pause while it's
 * open (the world store's overlay is what's open). `wide` is for windows with two panes.
 */
export function Modal({
  title,
  subtitle,
  icon,
  wide,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconData;
  wide?: boolean;
  children: ReactNode;
}) {
  const close = useWorld((s) => s.close);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog
        size={wide ? "xl" : "lg"}
        className={wide ? "game-dialog game-dialog--wide" : "game-dialog"}
      >
        <header className="game-dialog__head">
          <div className="game-dialog__titles">
            <Dialog.Title className="game-dialog__title">
              {icon && <Icon icon={icon} size={20} className="game-dialog__icon" />}
              {title}
            </Dialog.Title>
            {subtitle && (
              <Dialog.Description className="game-dialog__subtitle">{subtitle}</Dialog.Description>
            )}
          </div>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button
                {...props}
                variant="ghost"
                shape="square"
                size="sm"
                icon={<Icon icon={Cancel01Icon} />}
                aria-label="Close"
              />
            )}
          />
        </header>
        {children}
      </Dialog>
    </Dialog.Root>
  );
}
