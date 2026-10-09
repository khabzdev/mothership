import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { applyServerMsg } from "./cache";
import { RealtimeClient, type ConnectionState } from "./client";

interface RealtimeContextValue {
  client: RealtimeClient | null;
  state: ConnectionState;
}

const RealtimeContext = createContext<RealtimeContextValue>({ client: null, state: "closed" });

/** Opens the station socket in the browser and feeds it into the Query cache. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<RealtimeContextValue>({ client: null, state: "closed" });

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const client = new RealtimeClient(`${protocol}//${location.host}/_ws`);
    const offMessage = client.onMessage((msg) => applyServerMsg(queryClient, msg));
    const offState = client.onState((state) => setValue({ client, state }));
    client.connect();
    return () => {
      offMessage();
      offState();
      client.close();
    };
  }, [queryClient]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
