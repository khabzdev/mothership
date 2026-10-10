import { Switch } from "@cloudflare/kumo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNote } from "../../../shared/ui/ErrorNote";
import { checksQuery } from "../../preflight/queries";
import { setInspectorMutation } from "../queries";

/** The deck's Inspector switch, on Flight Control beside the pre-flight switches. */
export function InspectorSwitch({ deckId }: { deckId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery(checksQuery(deckId));
  const set = useMutation(setInspectorMutation(queryClient, deckId));
  return (
    <div className="inspector-switch">
      <Switch
        label="Inspector"
        checked={data?.inspector === true}
        disabled={!data || set.isPending}
        onCheckedChange={(on) => set.mutate(on)}
      />
      <p className="inspector-switch__note">Reviews every stop with one extra Claude run.</p>
      <ErrorNote error={set.error} />
    </div>
  );
}
