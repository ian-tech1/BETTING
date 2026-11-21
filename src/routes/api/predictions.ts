import { createFileRoute } from "@tanstack/react-router";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0" };

export const Route = createFileRoute("/api/predictions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [{ loadPredictions, loadMarketBenchmarks }, { perLeagueAccuracy }, { checkDatabaseHealth }] = await Promise.all([
            import("@/lib/tracker.server"),
            import("@/lib/analysis"),
            import("@/lib/db"),
          ]);
          const database = await checkDatabaseHealth();
          if (database.configured && !database.connected) {
            return Response.json({ error: "Prediction storage is temporarily unavailable.", database: { provider: database.provider, connected: false, durable: database.durable } }, { status: 503, headers: jsonHeaders });
          }
          const all = database.connected ? await loadPredictions() : [];
          const url = new URL(request.url);
          const requested = Number(url.searchParams.get("limit") ?? 1000);
          const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 1000;
          const rows = all.slice(-limit);
          const eligible = all.filter((row) => row.result && Date.parse(row.recordedAt) < Date.parse(row.kickoffAt));
          const keys = ["home", "draw", "away"] as const;
          const hitCount = eligible.filter((row) => keys.reduce((best, key) => row.final[key] > row.final[best] ? key : best, "home") === row.result).length;
          const brier = eligible.length ? eligible.reduce((sum, row) => sum + keys.reduce((score, key) => score + (row.final[key] - (key === row.result ? 1 : 0)) ** 2, 0), 0) / eligible.length : null;
          const logLoss = eligible.length ? -eligible.reduce((sum, row) => sum + Math.log(Math.max(1e-9, row.final[row.result!])), 0) / eligible.length : null;
          const perLeague = perLeagueAccuracy(eligible.map((row) => ({
            league: row.league,
            final: row.final,
            result: row.result!,
            recordedAt: row.recordedAt,
            kickoffAt: row.kickoffAt,
          })));
          const marketBenchmarks = database.connected ? await loadMarketBenchmarks(rows) : [];
          const picks = rows.map((row) => ({
            matchId: row.matchId,
            home: row.home,
            away: row.away,
            league: row.league,
            kickoffAt: row.kickoffAt,
            recordedAt: row.recordedAt,
            probabilities: row.final,
            pick: row.pick,
            code: row.code,
            tier: row.tier,
            result: row.result,
          }));
          return Response.json({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            returned: rows.length,
            total: all.length,
            database: { provider: database.provider, connected: database.connected, durable: database.durable, checkedAt: database.checkedAt },
            log: rows,
            picks,
            accuracy: {
              settledPreKickoff: eligible.length,
              topPickCorrect: hitCount,
              topPickRate: eligible.length ? hitCount / eligible.length : null,
              brier,
              logLoss,
              perLeague,
              note: "Descriptive completed-log metrics only; they are not a guarantee of future accuracy.",
            },
            marketBenchmarks,
          }, { headers: jsonHeaders });
        } catch {
          return Response.json({ error: "Prediction data is temporarily unavailable." }, { status: 503, headers: jsonHeaders });
        }
      },
    },
  },
});
