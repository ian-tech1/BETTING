import { createFileRoute } from "@tanstack/react-router";
import { checkDatabaseHealth } from "@/lib/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const database = await checkDatabaseHealth();
        return Response.json({
          ok: database.connected || !database.configured,
          service: "iantech-football-predictions",
          version: "operations-v1",
          database: { provider: database.provider, connected: database.connected, durable: database.durable },
          checkedAt: new Date().toISOString(),
        }, { status: database.configured && !database.connected ? 503 : 200, headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
