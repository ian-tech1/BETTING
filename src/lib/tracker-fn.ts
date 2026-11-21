import { createServerFn } from "@tanstack/react-start";
import type { PredictionRow } from "@/lib/tracker";
import type { DatabaseHealth } from "@/lib/db";
import type { MarketBenchmark } from "@/lib/tracker.server";

export type TrackerSnapshot = {
  rows: PredictionRow[];
  marketBenchmarks: MarketBenchmark[];
  recording: { recorded: number; alreadyLogged: number; skipped: { noKickoff: number; passed: number } };
  settling: { settled: number; waiting: number; note: string };
  serverTime: string;
  dataKeys: { footballData: boolean };
  database: DatabaseHealth;
};
export type TrackerView = Pick<TrackerSnapshot, "rows" | "marketBenchmarks" | "serverTime" | "database">;

/** Read-only view of the log. */
export const getTracker = createServerFn({ method: "GET" }).handler(async (): Promise<TrackerView> => {
  const [{ loadPredictions, loadMarketBenchmarks }, { checkDatabaseHealth }] = await Promise.all([
    import("@/lib/tracker.server"),
    import("@/lib/db"),
  ]);
  const database = await checkDatabaseHealth();
  if (!database.connected) return { rows: [], marketBenchmarks: [], database, serverTime: new Date().toISOString() };
  const rows = await loadPredictions();
  const marketBenchmarks = await loadMarketBenchmarks(rows);
  return { rows, marketBenchmarks, database, serverTime: new Date().toISOString() };
});

/**
 * Records forecasts for fixtures that have not kicked off, settles finished ones, and returns the log.
 * Takes no input: every probability and timestamp is produced on the server.
 */
let lastSyncAt = 0;
export const syncTracker = createServerFn({ method: "POST" }).handler(async (): Promise<TrackerSnapshot> => {
  const [{ recordUpcoming, settlePending, loadPredictions, loadMarketBenchmarks }, { checkDatabaseHealth }] = await Promise.all([
    import("@/lib/tracker.server"),
    import("@/lib/db"),
  ]);
  const { env } = await import("@/lib/env.server");
  const database = await checkDatabaseHealth();
  const serverTime = new Date().toISOString();
  if (!database.connected) {
    return {
      rows: [], marketBenchmarks: [],
      recording: { recorded: 0, alreadyLogged: 0, skipped: { noKickoff: 0, passed: 0 } },
      settling: { settled: 0, waiting: 0, note: database.note },
      serverTime, dataKeys: { footballData: !!env("FOOTBALL_DATA_KEY") }, database,
    };
  }
  const now = Date.now();
  const throttled = now - lastSyncAt < 60_000;
  if (!throttled) lastSyncAt = now;
  const recording = throttled ? { recorded: 0, alreadyLogged: 0, skipped: { noKickoff: 0, passed: 0 } } : await recordUpcoming();
  const settling = throttled
    ? { settled: 0, waiting: 0, note: "A sync ran recently; try again in a minute." }
    : await settlePending();
  const rows = await loadPredictions();
  const marketBenchmarks = await loadMarketBenchmarks(rows);
  return { rows, marketBenchmarks, recording, settling, serverTime: new Date().toISOString(), dataKeys: { footballData: !!env("FOOTBALL_DATA_KEY") }, database };
});
