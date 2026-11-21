import { useCallback, useEffect, useMemo, useState } from "react";
import { getTracker, syncTracker, type TrackerSnapshot, type TrackerView } from "@/lib/tracker-fn";
import { buildDashboard, modelPerformance, toCsv, topCorrect, tipCovered, type PredictionRow } from "@/lib/tracker";
import { MIN_SAMPLE } from "@/lib/backtest";

const pc = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const num = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const NAME = { home: "Home", draw: "Draw", away: "Away" } as const;

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-raised p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

function Spark({ points }: { points: { upTo: number; brier: number }[] }) {
  if (points.length < 2) return null;
  const w = 320, h = 70, pad = 6;
  const ys = points.map((p) => p.brier);
  const lo = Math.min(...ys), hi = Math.max(...ys, lo + 0.01);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[70px] w-full max-w-sm" role="img" aria-label={`Rolling Brier score from ${num(ys[0])} to ${num(ys[ys.length - 1])}; lower is better`}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-signal" points={points.map((p, i) => `${x(i)},${y(p.brier)}`).join(" ")} />
    </svg>
  );
}

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted" aria-label="not applicable">–</span>;
  return ok ? <span className="text-signal" aria-label="correct">✓</span> : <span aria-label="incorrect">✗</span>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Filter = "all" | "correct" | "incorrect" | "confident";

/** Historical performance: forecasts frozen before kickoff, scored against real results. */
export function PerformanceDashboard() {
  const [snap, setSnap] = useState<TrackerView | null>(null);
  const [syncSummary, setSyncSummary] = useState<Pick<TrackerSnapshot, "recording" | "settling"> | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    setBusy(true);
    setFailed(false);
    getTracker()
      .then((s: TrackerView) => setSnap(s))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, []);
  const sync = useCallback(() => {
    setSyncing(true);
    setFailed(false);
    syncTracker()
      .then((s: TrackerSnapshot) => {
        setSnap({ rows: s.rows, marketBenchmarks: s.marketBenchmarks, serverTime: s.serverTime, database: s.database });
        setSyncSummary({ recording: s.recording, settling: s.settling });
      })
      .catch(() => setFailed(true))
      .finally(() => setSyncing(false));
  }, []);
  useEffect(load, [load]);

  const d = useMemo(() => (snap ? buildDashboard(snap.rows) : null), [snap]);
  const models = useMemo(() => (snap ? modelPerformance(snap.rows) : []), [snap]);
  const marketSummary = useMemo(() => {
    const benchmarks = snap?.marketBenchmarks ?? [];
    const movement = benchmarks.filter((row) => row.movement !== null);
    const closes = benchmarks.filter((row) => row.closeProbabilityGap !== null);
    return {
      movementMatches: movement.length,
      closeMatches: closes.length,
      meanCloseGap: closes.length ? closes.reduce((sum, row) => sum + (row.closeProbabilityGap ?? 0), 0) / closes.length : null,
      closeRows: closes.slice(-8).reverse(),
    };
  }, [snap]);
  const shown = useMemo(() => {
    if (!d) return [] as PredictionRow[];
    const base = filter === "correct" ? d.outcomes.correct : filter === "incorrect" ? d.outcomes.incorrect : filter === "confident" ? d.outcomes.confidentMisses : d.buckets.settled;
    return [...base].reverse();
  }, [d, filter]);

  return (
    <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="perf-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="perf-title" className="font-display text-2xl">Performance dashboard</h2>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted">
            Each forecast is frozen before kick-off, then scored against the real result. Confidence alone is not counted as accuracy.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={busy} className="rounded-full border border-line px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? "Checking…" : "Refresh"}
          </button>
          <button type="button" onClick={sync} disabled={syncing} className="rounded-full border border-line px-3 py-1.5 text-xs disabled:opacity-50">
            {syncing ? "Syncing…" : "Sync log"}
          </button>
          <button
            type="button"
            disabled={!snap || !snap.rows.length}
            onClick={() => snap && download(`iantech-predictions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(snap.rows))}
            className="rounded-full border border-line px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Export CSV backup
          </button>
        </div>
      </div>

      {failed ? <p className="mt-3 text-sm text-muted">The prediction log could not be loaded right now. Try Refresh.</p> : null}
      {!snap && !failed ? <p className="mt-3 text-sm text-muted">Loading the prediction log…</p> : null}

      {snap && d ? (
        <div className="mt-4 flex flex-col gap-5 text-sm">
          <div className="rounded-card border border-line bg-raised px-3 py-2 text-xs" role="status">
            <p className="font-medium">
              {snap.database.provider === "supabase" ? "Supabase" : snap.database.provider === "pglite" ? "Preview database" : snap.database.provider === "unconfigured" ? "Database" : "Postgres"}: {snap.database.connected ? "connected" : "not connected"}
              {snap.database.durable ? " · durable" : snap.database.provider === "unconfigured" ? " · not configured" : " · ephemeral"}
              {snap.database.latencyMs === null ? "" : ` · ${snap.database.latencyMs} ms`}
            </p>
            <p className="mt-1 text-muted">{snap.database.note}</p>
            <p className="mt-1 text-muted">Checked {when(snap.database.checkedAt)}. Refresh checks health only; Sync log is an explicit write.</p>
          </div>
          <div className="rounded-card border border-line bg-raised px-3 py-3">
            <h3 className="font-medium">Odds movement and close-line proxy</h3>
            <p className="mt-1 text-xs text-muted">
              Uses stored The Odds API observations. A close proxy appears only when a provider timestamp is within three hours before kick-off; it is not an official close or placed-bet CLV.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile label="Matches with timestamped movement" value={marketSummary.movementMatches} />
              <Tile label="Pre-kickoff quote proxies" value={marketSummary.closeMatches} />
              <Tile label="Mean model − fair-market probability" value={marketSummary.meanCloseGap === null ? "n/a" : `${(marketSummary.meanCloseGap * 100).toFixed(1)} pp`} />
            </div>
            {marketSummary.closeRows.length ? (
              <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {marketSummary.closeRows.map((market) => {
                  const row = snap.rows.find((item) => item.matchId === market.matchId);
                  return <li key={market.matchId}>{row ? `${row.home} v ${row.away}` : market.matchId}: {(market.closeProbabilityGap! * 100).toFixed(1)} pp, {market.closeBooks} book(s), observed {market.closeObservedAt ? when(market.closeObservedAt) : "time unavailable"}.</li>;
                })}
              </ul>
            ) : <p className="mt-2 text-xs text-muted">No qualifying pre-kickoff observations have been collected yet.</p>}
          </div>
          {syncSummary ? (
            <div className="rounded-card border border-line bg-raised px-3 py-2 text-xs" role="status">
              <p>This sync: {syncSummary.recording.recorded} new forecast{syncSummary.recording.recorded === 1 ? "" : "s"} frozen, {syncSummary.recording.alreadyLogged} already logged.</p>
              <p className="mt-1 text-muted">{syncSummary.settling.note}</p>
            </div>
          ) : null}

          <div>
            <h3 className="font-medium">Individual AI model performance</h3>
            <p className="mt-1 text-xs text-muted">Scores use each model’s immutable pre-kickoff probability snapshot. Older forecasts without a snapshot are not backfilled.</p>
            {models.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[38rem] text-xs">
                  <thead className="text-muted"><tr>
                    <th className="pb-1 pr-2 text-left font-normal">Model</th>
                    <th className="pb-1 pr-2 text-right font-normal">n</th>
                    <th className="pb-1 pr-2 text-right font-normal">Hit rate</th>
                    <th className="pb-1 pr-2 text-right font-normal">Brier ↓</th>
                    <th className="pb-1 text-right font-normal">Log loss ↓</th>
                  </tr></thead>
                  <tbody>{models.map((model) => (
                    <tr key={model.id} className="border-t border-line">
                      <td className="py-1.5 pr-2">{model.name}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{model.n}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{pc(model.hitRate)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(model.brier)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(model.logLoss)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="mt-1 text-xs text-muted">No settled forecasts with individual-model snapshots are available yet. New pre-kickoff syncs will populate this table.</p>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Forecasts logged" value={d.counts.recorded} hint={Number.isFinite(d.avgLeadHours) ? `avg ${d.avgLeadHours.toFixed(1)} h before kick-off` : undefined} />
            <Tile label="Pending results" value={d.counts.pending} />
            <Tile label="Settled" value={d.counts.settled} hint={`${MIN_SAMPLE} needed for a verdict`} />
            <Tile label="Excluded" value={d.counts.excluded} hint="recorded after kick-off" />
          </div>

          <div>
            <h3 className="font-medium">Accuracy so far</h3>
            <p className="mt-1 rounded-card border border-line bg-raised px-3 py-2 text-xs">{d.report.verdictText}</p>
            {d.counts.settled > 0 ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Top pick correct" value={pc(d.report.primary.hitRate)} hint={`${d.report.primary.hits}/${d.report.primary.n}, 95% range ${pc(d.report.primary.hitLow)}–${pc(d.report.primary.hitHigh)}`} />
                  <Tile label="Brier score" value={num(d.report.primary.brier)} hint={`base-rate guess ${num(d.report.baselines.frequency.brier)}`} />
                  <Tile label="Log loss" value={num(d.report.primary.logLoss)} hint={`equal thirds ${num(d.report.baselines.uniform.logLoss)}`} />
                  <Tile label="Skill vs base rates" value={num(d.report.skill.primary)} hint="above 0 beats a frequency guess" />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Tips covering the result (including double chances): {d.outcomes.tipHits}/{d.outcomes.tipsMade}. PASS calls: {d.outcomes.passes}.
                  Engine alone: {pc(d.report.engine.hitRate)}, AI lab alone: {pc(d.report.ai.hitRate)}. Always-home baseline: {pc(d.report.baselines.alwaysHome.hitRate)}.
                </p>
              </>
            ) : null}
          </div>

          {d.counts.settled > 0 ? (
            <div>
              <h3 className="font-medium">Is it improving, or just looking confident?</h3>
              <p className="mt-1 text-xs text-muted">{d.trend.text}</p>
              <Spark points={d.rolling} />
              {d.rolling.length >= 2 ? <p className="text-[11px] text-muted">Rolling 20-match Brier score; lower is better.</p> : null}
              <p className="mt-2 text-xs text-muted">
                Models agreed on {d.report.agreement.agree.n} matches ({pc(d.report.agreement.agree.hitRate)} correct) and disagreed on {d.report.agreement.disagree.n} ({pc(d.report.agreement.disagree.hitRate)} correct).
                {d.counts.settled < MIN_SAMPLE ? " Too few matches to treat agreement as a signal." : ""}
              </p>
            </div>
          ) : null}

          {d.report.calibration.length ? (
            <div>
              <h3 className="font-medium">Confidence calibration</h3>
              <p className="mt-1 text-xs text-muted">When the app said X%, how often did that outcome happen?</p>
              <ul className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {d.report.calibration.map((b) => (
                  <li key={b.from} className="tabular-nums">
                    Said {pc(b.predicted)} → happened {pc(b.observed)} ({b.n} outcomes)
                    {b.n >= 10 && Math.abs(b.predicted - b.observed) > 0.1 ? (b.predicted > b.observed ? " · overconfident" : " · underconfident") : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {d.report.tiers.length ? (
            <div>
              <h3 className="font-medium">By tier</h3>
              <ul className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {d.report.tiers.map((t) => (
                  <li key={t.tier}>Tier {t.tier}: {pc(t.card.hitRate)} correct over {t.card.n} ({pc(t.card.hitLow)}–{pc(t.card.hitHigh)})</li>
                ))}
              </ul>
            </div>
          ) : null}

          {d.byVersion.length > 1 ? (
            <div>
              <h3 className="font-medium">By model version</h3>
              <ul className="mt-1 text-xs text-muted">
                {d.byVersion.map((v) => (
                  <li key={v.version}>{v.version}: Brier {num(v.card.brier)}, hit rate {pc(v.card.hitRate)}, {v.card.n} matches</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="font-medium">Per-league results</h3>
            <p className="mt-1 text-xs text-muted">Only forecasts frozen before kick-off and later settled are included. Small samples are descriptive, not proof of an edge.</p>
            {d.byLeague.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-xs">
                  <thead className="text-muted"><tr>
                    <th className="pb-1 pr-2 text-left font-normal">League</th>
                    <th className="pb-1 pr-2 text-right font-normal">n</th>
                    <th className="pb-1 pr-2 text-right font-normal">Top pick</th>
                    <th className="pb-1 pr-2 text-right font-normal">Brier ↓</th>
                    <th className="pb-1 text-right font-normal">Log loss ↓</th>
                  </tr></thead>
                  <tbody>{d.byLeague.map((row) => (
                    <tr key={row.league} className="border-t border-line">
                      <td className="py-1.5 pr-2">{row.league}{row.n < MIN_SAMPLE ? <span className="text-muted"> · early sample</span> : ""}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{row.n}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{pc(row.hitRate)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{num(row.brier)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(row.logLoss)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="mt-1 text-xs text-muted">No settled pre-kickoff records are available yet.</p>}
          </div>

          <div>
            <h3 className="font-medium">Pending matches awaiting results ({d.buckets.pending.length})</h3>
            {d.buckets.pending.length ? (
              <ul className="mt-1 flex flex-col gap-1 text-xs">
                {d.buckets.pending.map((r) => {
                  const over = Date.parse(r.kickoffAt) + 2 * 3600000 < Date.parse(snap.serverTime);
                  return (
                    <li key={r.matchId} className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5">
                      <span>{r.home} v {r.away} <span className="text-muted">· {when(r.kickoffAt)}</span></span>
                      <span className="text-muted">Tip {r.code === "PASS" ? "PASS" : `${NAME[r.pick]} (${r.code})`} {pc(r.final[r.pick])} · {over ? "result due" : "not played yet"}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted">Nothing pending. New forecasts are frozen automatically when a fixture with a verified future kick-off appears.</p>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Settled match history and correct vs incorrect reports</h3>
              <div className="flex gap-1 text-xs" role="group" aria-label="Filter settled matches">
                {([["all", `All (${d.counts.settled})`], ["correct", `Correct (${d.outcomes.correct.length})`], ["incorrect", `Incorrect (${d.outcomes.incorrect.length})`], ["confident", `Confident misses (${d.outcomes.confidentMisses.length})`]] as [Filter, string][]).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`rounded-full border px-2.5 py-1 ${filter === id ? "border-signal text-signal" : "border-line text-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {shown.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="pb-1 pr-2 text-left font-normal">Match</th>
                      <th className="pb-1 pr-2 text-left font-normal">Frozen tip</th>
                      <th className="pb-1 pr-2 text-left font-normal">Score</th>
                      <th className="pb-1 pr-2 text-left font-normal">Result</th>
                      <th className="pb-1 pr-2 text-left font-normal">Top pick</th>
                      <th className="pb-1 text-left font-normal">Tip covered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.matchId} className="border-t border-line">
                        <td className="py-1.5 pr-2">{r.home} v {r.away}<br /><span className="text-muted">{when(r.kickoffAt)}</span></td>
                        <td className="py-1.5 pr-2">{NAME[r.pick]} {pc(r.final[r.pick])}<br /><span className="text-muted">{r.code} · tier {r.tier}</span></td>
                        <td className="py-1.5 pr-2 tabular-nums">{r.homeGoals}–{r.awayGoals}</td>
                        <td className="py-1.5 pr-2">{NAME[r.result!]}</td>
                        <td className="py-1.5 pr-2"><Mark ok={topCorrect(r)} /></td>
                        <td className="py-1.5"><Mark ok={tipCovered(r)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">No settled matches in this view yet.</p>
            )}
          </div>

          <details className="rounded-card border border-line bg-raised p-3">
            <summary className="cursor-pointer text-sm font-medium">How post-match information is kept out</summary>
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">
              <li>The server computes each forecast and stamps the time itself; the browser cannot send probabilities or a date.</li>
              <li>A forecast is only recorded if the kick-off time is verified and still in the future. The database also refuses any row recorded at or after kick-off.</li>
              <li>Logged forecasts are never rewritten. Only the result columns are filled in, once, by the results feed.</li>
              <li>Every row stores the model version and a fingerprint of the inputs used, so later changes are visible.</li>
              <li>Results are matched by team names, home/away order and a 36-hour window, and use the 90-minute score.</li>
              <li>Rows recorded after kick-off (should be none) are excluded from every metric and flagged in the CSV.</li>
              <li>The frozen forecast is the stats-only tip. Live odds, injuries and AI nudges seen on a match card are not part of it.</li>
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}
