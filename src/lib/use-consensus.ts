import { useCallback, useEffect, useMemo, useState } from "react";
import type { Side } from "@/data/weekend";
import { buildConsensus, type Consensus, type SourceRecord } from "@/lib/consensus";
import { getMatchSignals, getPredictionLearningHistory, type SignalReply } from "@/lib/signals-fn";
import type { Triple } from "@/lib/engines";

let learningHistoryCache: Promise<SourceRecord[]> | null = null;
function loadLearningHistory(force = false): Promise<SourceRecord[]> {
  if (force || !learningHistoryCache) {
    learningHistoryCache = getPredictionLearningHistory().then((rows: SourceRecord[]) => rows).catch(() => []);
  }
  return learningHistoryCache;
}

/** One reconciled Final tip that every screen shares, with server signals and recorded results folded in. */
export function useConsensus(id: string, home: Side, away: Side, opts: { odds?: Triple; live?: boolean; league?: string } = {}): Consensus & { signalsUsed: string[]; providerSignals: SignalReply | null; refreshSignals: () => Promise<void> } {
  const [history, setHistory] = useState<SourceRecord[]>([]);
  const [signals, setSignals] = useState<SignalReply | null>(null);
  const refreshSignals = useCallback(async () => {
    const [freshSignals, freshHistory] = await Promise.all([
      getMatchSignals({ data: id }),
      loadLearningHistory(true),
    ]);
    setSignals(freshSignals);
    setHistory(freshHistory);
  }, [id]);
  useEffect(() => {
    let alive = true;
    loadLearningHistory().then((rows: SourceRecord[]) => alive && setHistory(rows));
    getMatchSignals({ data: id }).then((s: SignalReply) => alive && setSignals(s)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  const c = useMemo(
    () => buildConsensus(home, away, { odds: opts.odds, history, league: opts.league, live: opts.live, signals: signals ?? undefined }),
    [home, away, opts.odds, opts.league, opts.live, history, signals],
  );
  return { ...c, signalsUsed: signals?.used ?? [], providerSignals: signals, refreshSignals };
}
