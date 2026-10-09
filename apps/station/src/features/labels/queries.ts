import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { listLabels, setLabel } from "./labels.functions";
import type { LabelInput } from "./model";

export const labelKeys = {
  deck: (deckId: string) => ["decks", deckId, "labels"] as const,
};

export const labelsQuery = (deckId: string) =>
  queryOptions({
    queryKey: labelKeys.deck(deckId),
    queryFn: () => listLabels({ data: { deckId } }),
  });

export const setLabelMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (input: LabelInput) => setLabel({ data: input }),
    onSuccess: (labels, input) => queryClient.setQueryData(labelKeys.deck(input.deckId), labels),
  });
