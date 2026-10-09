import { useSuspenseQuery } from "@tanstack/react-query";
import { missionsQuery } from "../queries";
import { BriefEditor } from "./BriefEditor";
import { MissionCard } from "./MissionCard";
import { useMissionLiveUpdates } from "./useMissionLiveUpdates";

/** A deck's missions and the brief editor. */
export function MissionBoard({ deckId }: { deckId: string }) {
  const { data: missions } = useSuspenseQuery(missionsQuery(deckId));
  useMissionLiveUpdates(deckId);

  return (
    <div className="board">
      <BriefEditor deckId={deckId} />
      <section className="board__missions" aria-label="Missions">
        {missions.length === 0 ? (
          <p className="muted empty">No missions on this deck yet. Write a brief to start one.</p>
        ) : (
          missions.map((record) => <MissionCard key={record.id} record={record} />)
        )}
      </section>
    </div>
  );
}
