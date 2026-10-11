import type { CrewInfo } from "@spaceship/protocol";
import { useQuery } from "@tanstack/react-query";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { Icon } from "../../../shared/ui/Icon";
import { recordView, type Patch } from "../model";
import { serviceRecordQuery } from "../queries";
import { PATCH_ICONS } from "./PatchIcons";
import { RankChevrons } from "./RankChevrons";

function PatchList({ patches, locked }: { patches: Patch[]; locked?: boolean }) {
  return (
    <ul className="record__patches">
      {patches.map((p) => (
        <li key={p.id} className="record__patch" data-locked={locked || undefined}>
          <Icon icon={PATCH_ICONS[p.id]} size={18} />
          <span className="record__patch-name">{p.name}</span>
          <span className="record__patch-rule">{p.rule}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * K at a console with crew: its call sign's service record on this deck. Rank and points, what the
 * next rank takes, the counters, and the patches earned (in the order earned) and still locked.
 */
export function ServiceRecordWindow({ member }: { member: CrewInfo }) {
  const { data, error } = useQuery(serviceRecordQuery(member.id));
  const view = data && recordView(data.record);
  return (
    <div className="record">
      <ErrorNote error={error} />
      {!data && !error && <p className="record__note">Loading…</p>}
      {view && (
        <>
          <p className="record__rank">
            <RankChevrons title={view.rank} size={16} />
            <strong>{view.rank}</strong>
            <span className="record__note">
              {view.points} {view.points === 1 ? "point" : "points"}
              {view.toNext && ` · ${view.toNext}`}
            </span>
          </p>
          <dl className="record__counters">
            {view.counters.map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd>{c.value}</dd>
              </div>
            ))}
          </dl>
          <section>
            <h3 className="record__heading">Patches earned</h3>
            {view.earned.length ? (
              <PatchList patches={view.earned} />
            ) : (
              <p className="record__note">None yet.</p>
            )}
          </section>
          {view.locked.length > 0 && (
            <section>
              <h3 className="record__heading">Still to earn</h3>
              <PatchList patches={view.locked} locked />
            </section>
          )}
        </>
      )}
    </div>
  );
}
