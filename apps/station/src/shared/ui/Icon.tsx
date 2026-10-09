import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

export type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

/** A Hugeicons icon in the current text colour, sized to sit in a line of text or a Kumo button. */
export function Icon({
  icon,
  size = 16,
  label,
  className,
}: {
  icon: IconData;
  size?: number;
  /** Read out by screen readers; without it the icon is decorative. */
  label?: string;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.75}
      color="currentColor"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
