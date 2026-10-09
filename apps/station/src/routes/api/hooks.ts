import { createFileRoute } from "@tanstack/react-router";
import { defaultHookDeps, handleHookRequest } from "../../features/crew/hooks.server";

export const Route = createFileRoute("/api/hooks")({
  server: {
    handlers: {
      POST: ({ request }) => handleHookRequest(request, defaultHookDeps),
      GET: () => new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }),
    },
  },
});
