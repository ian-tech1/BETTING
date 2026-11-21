import { createFileRoute } from "@tanstack/react-router";
import { operationalStatus } from "@/lib/ops.server";

export const Route = createFileRoute("/api/ops/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await operationalStatus(), { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ error: "Operational status is temporarily unavailable." }, { status: 503 });
        }
      },
    },
  },
});
