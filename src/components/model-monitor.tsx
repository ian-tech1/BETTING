import { useMemo } from "react";
import { MATCHES } from "@/lib/price";
import { buildConsensus, type SourceRecord } from "@/lib/consensus";
import { loadHistory } from "@/lib/consensus-history";
import { buildAdvancedReport } from "@/lib/advanced-predictors";
import { pct } from "@/lib/format";

type Side = "home" | "draw" | "away";
const OUTCOME: Record<Side, string> = { home: "Home", draw: "Draw", away: "Away" };

function accuracy(rows: SourceRecord[], key: "engine" | "ai") {
  if (!rows.length) return null;
  return rows.filter((row) => {
    const pick = (Object.keys(row[key]) as Side[]).reduce((best, side) => row[key][side] > row[key][best] ? side : best, "home" as Side);
    return pick === row.result;
  }).length / rows.length;
}

function brier(rows: SourceRecord[], key: "engine" | "ai") {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + (Object.keys(row[key]) as Side[]).reduce((score, side) => score + (row[key][side] - (row.result === side ? 1 : 0)) ** 2, 0), 0) / rows.length;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "border-emerald-400/60 text-emerald-300" : tone === "warn" ? "border-amber-400/60 text-amber-200" : tone === "bad" ? "border-red-400/60 text-red-300" : "border-line text-muted";
  return <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function ModelMonitor() {
  const history = useMemo(() => loadHistory(), []);
  const match = MATCHES[0];
  const report = useMemo(() => buildAdvancedReport(match.home, match.away), [match]);
  const consensus = useMemo(() => buildConsensus(match.home, match.away, { history, league: match.league }), [history, match]);
  const recent = history.slice(-20);
  const engineAccuracy = accuracy(recent, "engine");
  const aiAccuracy = accuracy(recent, "ai");
  const engineBrier = brier(recent, "engine");
  const aiBrier = brier(recent, "ai");
  const best = engineBrier === null || aiBrier === null ? "Balanced start" : engineBrier <= aiBrier ? "Statistical engine" : "AI-style lab";
  const settled = history.length > 0;
  const calibrationGap = recent.length
    ? recent.reduce((sum, row) => {
        const source = row.final ?? row.engine;
        const top = Math.max(source.home, source.draw, source.away);
        const hit = source[row.result] ? 1 : 0;
        return sum + Math.abs(top - hit);
      }, 0) / recent.length
    : null;
  const leaveOneOut = report.models.filter((model) => {
    const others = report.models.filter((candidate) => candidate.id !== model.id);
    const votes = others.filter((candidate) => {
      const values = candidate.probabilities;
      return values[report.pick] >= Math.max(values.home, values.draw, values.away);
    }).length;
    return votes >= Math.ceil(others.length / 2);
  }).length;
  const marketPrices = match.books.map((book) => book.odds[consensus.pick]).filter((value) => Number.isFinite(value) && value > 1);
  const marketDispersion = marketPrices.length ? Math.max(...marketPrices) - Math.min(...marketPrices) : null;
  const formPoints = (form: readonly string[]) => form.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
  const formMomentum = formPoints(match.home.form) - formPoints(match.away.form);
  const recencySkill = (key: "engine" | "ai") => {
    if (!recent.length) return null;
    let weightedHits = 0;
    let totalWeight = 0;
    recent.forEach((row, index) => {
      const weight = Math.pow(0.92, recent.length - index - 1);
      const pick = (Object.keys(row[key]) as Side[]).reduce((bestSide, side) => row[key][side] > row[key][bestSide] ? side : bestSide, "home" as Side);
      weightedHits += pick === row.result ? weight : 0;
      totalWeight += weight;
    });
    return weightedHits / totalWeight;
  };
  const recentEngineSkill = recencySkill("engine");
  const recentAiSkill = recencySkill("ai");
  const drawCalibration = recent.length
    ? recent.reduce((sum, row) => sum + Math.abs((row.final ?? row.engine).draw - (row.result === "draw" ? 1 : 0)), 0) / recent.length
    : null;
  const sortedProbabilities = Object.values(consensus.probabilities).sort((a, b) => b - a);
  const topTwoCoverage = sortedProbabilities[0] + sortedProbabilities[1];
  const featureRows = [
    ["Historical winner", best, settled ? "Lower Brier score wins the next weighting window." : "Waiting for settled prediction results."],
    ["Engine accuracy", engineAccuracy === null ? "n/a" : pct(engineAccuracy), "Last 20 settled results."],
    ["AI-style accuracy", aiAccuracy === null ? "n/a" : pct(aiAccuracy), "Last 20 settled results."],
    ["Learning sample", `${history.length} results`, "Previous predictions retained for recalibration."],
    ["Engine / AI agreement", `${consensus.enginePick === consensus.aiPick ? "Aligned" : "Split"}`, `${OUTCOME[consensus.enginePick]} vs ${OUTCOME[consensus.aiPick]}.`],
    ["Final model margin", pct(consensus.probabilities[consensus.pick] - Math.max(...Object.entries(consensus.probabilities).filter(([key]) => key !== consensus.pick).map(([, value]) => value))), "Lead over the second outcome."],
    ["Stress stability", `${Math.round(report.stressStable ? 100 : 0)}%`, "Keeps the same lean under ±10% xG stress."],
    ["Probability spread", pct(report.spread), "Range between the 25 predictor outputs."],
    ["Recent form", `${match.home.short} ${match.home.form.join("")} · ${match.away.short} ${match.away.form.join("")}`, "Last five W/D/L marks."],
    ["Availability", `${match.home.out.length + match.away.out.length} listed`, "Named absences are shown on each fixture."],
    ["Odds alignment", match.desk ? "Value line found" : "PASS / verify price", "No edge is treated as a guarantee."],
    ["Data freshness", consensus.freshness.action.toUpperCase(), consensus.freshness.reasons[0] ?? "Current inputs available."],
    ["Dixon–Coles correction", "Active", "Adjusts low-score dependence for 0–0, 1–0, 0–1 and 1–1 outcomes."],
    ["Bayesian shrinkage", "Active", "Pulls small samples toward a 1.35-goal prior."],
    ["Monte Carlo", "2,400 runs", "Repeatable score simulations stress the adjusted goal rates."],
    ["Negative-binomial", "Active", "Tests wider-than-Poisson score variance."],
    ["Bivariate goals", "Active", "Allows a shared latent match-goal component."],
    ["Zero-inflated case", "Active", "Checks whether extra low-score mass changes the lean."],
    ["Table-position gap", `${Math.abs(match.home.pos - match.away.pos)} places`, `${match.home.short} ${match.home.pos} · ${match.away.short} ${match.away.pos}.`],
    ["xG attack gap", `${(match.home.xgFor - match.away.xgFor).toFixed(2)}`, "Season expected-goals-for difference."],
    ["Goal-difference gap", `${((match.home.gf - match.home.ga) - (match.away.gf - match.away.ga))}`, "Observed season goal-difference comparison."],
    ["Draw probability", pct(consensus.probabilities.draw), "Keeps draw risk visible even when a side leads."],
    ["Prediction entropy", `${(-Object.values(consensus.probabilities).reduce((sum, p) => sum + p * Math.log(Math.max(p, 0.001)), 0)).toFixed(2)}`, "Higher entropy means a less decisive probability split."],
    ["Scoreline mode", match.score, "Most likely score from the goal grid; not a guarantee."],
    ["Best market price", `${match.best[consensus.pick].odds.toFixed(2)}`, `${match.best[consensus.pick].book} reference price for the reconciled outcome.`],
    ["Absence stress", `${match.home.out.length + match.away.out.length} listed`, "Named availability changes are tested as a separate stress scenario."],
    ["Calibration gap", calibrationGap === null ? "n/a" : `${Math.round(calibrationGap * 100)} pp`, "Average gap between stated top probability and settled outcome over the recent window."],
    ["Leave-one-model-out", `${leaveOneOut}/${report.models.length}`, "Checks whether the final lean survives removal of an individual model."],
    ["Bookmaker dispersion", marketDispersion === null ? "n/a" : marketDispersion.toFixed(2), "Difference between the highest and lowest available 1X2 price for the final outcome."],
    ["Form momentum", `${formMomentum >= 0 ? "+" : ""}${formMomentum} pts`, `${match.home.short} versus ${match.away.short} across the listed five-match form.`],
    ["Recency-weighted skill", recentEngineSkill === null || recentAiSkill === null ? "n/a" : `E ${Math.round(recentEngineSkill * 100)}% · AI ${Math.round(recentAiSkill * 100)}%`, "Recent settled predictions count more than older results."],
    ["Draw calibration", drawCalibration === null ? "n/a" : `${Math.round(drawCalibration * 100)} pp`, "Outcome-specific error for the draw probability on recent results."],
    ["Top-two coverage", `${Math.round(topTwoCoverage * 100)}%`, topTwoCoverage >= 0.78 ? "Two outcomes cover most probability; a single pick is less decisive." : "The leading outcome carries a larger share of the probability."],
  ] as const;
  const verdictTone = consensus.insufficientData ? "warn" : consensus.enginePick === consensus.aiPick ? "good" : "warn";

  return (
    <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="model-monitor-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">Decision layer</p>
          <h2 id="model-monitor-title" className="mt-1 font-display text-3xl">Final call monitor</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">The dashboard compares the two headline models against previous settled predictions, then makes one reconciled 1/X/2 call. Limited data lowers confidence rather than removing the selection.</p>
        </div>
        <Badge tone={verdictTone}>{`FINAL · ${OUTCOME[consensus.pick]}${consensus.insufficientData ? " · LOW CONFIDENCE" : ""}`}</Badge>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-card border border-line bg-raised p-3"><p className="text-xs text-muted">Final prediction</p><p className="mt-1 text-xl font-semibold">{OUTCOME[consensus.pick]}</p><p className="mt-1 text-xs text-muted">{Math.round(consensus.probabilities[consensus.pick] * 100)}% · {consensus.insufficientData ? "LOW confidence" : `tier ${consensus.tier}`}</p></div>
        <div className="rounded-card border border-line bg-raised p-3"><p className="text-xs text-muted">Best model now</p><p className="mt-1 text-xl font-semibold">{best}</p><p className="mt-1 text-xs text-muted">Historical weighting · {history.length} logged</p></div>
        <div className="rounded-card border border-line bg-raised p-3"><p className="text-xs text-muted">Two-model check</p><p className="mt-1 text-xl font-semibold">{consensus.enginePick === consensus.aiPick ? "Aligned" : "Split"}</p><p className="mt-1 text-xs text-muted">Engine {OUTCOME[consensus.enginePick]} · AI {OUTCOME[consensus.aiPick]}</p></div>
        <div className="rounded-card border border-line bg-raised p-3"><p className="text-xs text-muted">Confidence rule</p><p className="mt-1 text-xl font-semibold">{consensus.insufficientData ? "LOW" : "Measured"}</p><p className="mt-1 text-xs text-muted">Freshness, model split, margin and stress checks</p></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {featureRows.map(([name, value, note]) => <div key={name} className="rounded-card border border-line bg-raised p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs text-muted">{name}</p><span className="text-sm font-semibold tabular-nums text-fg">{value}</span></div><p className="mt-1 text-[11px] text-muted">{note}</p></div>)}
      </div>
      <p className="mt-3 text-[11px] text-muted">Historical accuracy is descriptive, not a guarantee. With fewer than 20 settled results the engine and AI weights remain balanced; the dashboard will not pretend a small sample proves a best model.</p>
    </section>
  );
}
