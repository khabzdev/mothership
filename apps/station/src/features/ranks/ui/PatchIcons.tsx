import { Tooltip } from "@cloudflare/kumo";
import {
  Award01Icon,
  CheckmarkBadge01Icon,
  Mortarboard01Icon,
  Rocket01Icon,
  Target02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon, type IconData } from "../../../shared/ui/Icon";
import { PATCHES, type PatchId } from "../model";

/** Each patch's icon. */
export const PATCH_ICONS: Record<PatchId, IconData> = {
  "first-launch": Rocket01Icon,
  "clean-sheet": CheckmarkBadge01Icon,
  "steady-hand": Tick02Icon,
  sharpshooter: Target02Icon,
  "old-hand": Award01Icon,
  teacher: Mortarboard01Icon,
};

/** The patches a call sign earned, in the order earned, each with its name and rule on hover. */
export function PatchIcons({ patches, size = 14 }: { patches?: string[]; size?: number }) {
  const earned = (patches ?? []).flatMap((id) => PATCHES.filter((p) => p.id === id));
  if (!earned.length) return null;
  return (
    <span className="patch-icons">
      {earned.map((p) => (
        <Tooltip
          key={p.id}
          content={`${p.name} · ${p.rule}`}
          render={<span className="patch-icons__patch" aria-label={`${p.name}: ${p.rule}`} />}
        >
          <Icon icon={PATCH_ICONS[p.id]} size={size} />
        </Tooltip>
      ))}
    </span>
  );
}
