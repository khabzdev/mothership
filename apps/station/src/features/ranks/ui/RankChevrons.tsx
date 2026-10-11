import { ChevronUpIcon, StarIcon } from "@hugeicons/core-free-icons";
import type { RankTitle } from "@mothership/protocol";
import { Icon } from "../../../shared/ui/Icon";
import { chevronsFor } from "../model";

const COUNTS = [[], [0], [0, 1], [0, 1, 2]] as const;

/** A rank's chevrons (a Captain's star), read out as the rank; nothing for a Cadet. */
export function RankChevrons({ title, size = 12 }: { title?: RankTitle; size?: number }) {
  if (!title) return null;
  const chevrons = chevronsFor(title);
  if (chevrons === 0) return null;
  return (
    <span className="rank-chevrons" role="img" aria-label={title}>
      {chevrons === "star" ? (
        <Icon icon={StarIcon} size={size} />
      ) : (
        COUNTS[chevrons].map((i) => <Icon key={i} icon={ChevronUpIcon} size={size} />)
      )}
    </span>
  );
}
