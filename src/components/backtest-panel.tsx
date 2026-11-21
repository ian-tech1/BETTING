import { useEffect, useState } from "react";
import { getBacktest } from "@/lib/signals-fn";
import type { BacktestReport, Scorecard } from "@/lib/backtest";
import { MIN_SAMPLE } from "@/lib/backtest";

const pc = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const num = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

function Row({ label, c }: { label: string; c: Scorecard }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{label}</th>
      <td className="py-1.5 pr-3 tabular-nums">{c.hits}/{c.n}</td>
      <td className="py-1.5 pr-3 tabular-nums">{pc(c.hitRate)} <span className="text-muted">({pc(c.hitLow)}–{pc(c.hitHigh)})</span></td>
      <td className="py-1.5 pr-3 tabular-nums">{num(c.brier)}</td>
      <td className="py-1.5 tabular-nums">{num(c.logLoss)}</td>
    </tr>
  );
}

/** Measured accuracy against completed matches. Agreement between models is shown only as a thing to test, never as proof. */
export function BacktestPanel() {
  const [r, setR] = useState<BacktestReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getBacktest().then((x: BacktestReport) => alive && setR(x)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="font-display text-2xl">Retrospective backtest (not pre-recorded)</h2>
      <p className="mt-2 text-pretty text-sm text-muted">
        These matches were scored after they finished, from bundled statistics, so they are NOT counted in the dashboard above. They only show how the model would have done. Accuracy is judged by comparing probabilities with real results, not by how many models agree. Hit rates show a 95% range because small samples are mostly luck. Lower Brier and log loss are better.
      </p>
      {failed ? <p className="mt-3 text-sm text-muted">The backtest could not be loaded right now.</p> : null}
      {!r && !failed ? <p className="mt-3 text-sm text-muted">Scoring completed matches…</p> : null}
      {r ? (
        <div className="mt-3 flex flex-col gap-4 text-sm">
          <p className="rounded-card border border-line bg-raised px-3 py-2" role="status">
            <strong>{r.n} completed matches.</strong> {r.verdictText}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="pb-1 pr-3 text-left font-normal">Forecaster</th>
                  <th className="pb-1 pr-3 text-left font-normal">Correct</th>
                  <th className="pb-1 pr-3 text-left font-normal">Hit rate (95% range)</th>
                  <th className="pb-1 pr-3 text-left font-normal">Brier</th>
                  <th className="pb-1 text-left font-normal">Log loss</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Statistical engine" c={r.engine} />
                <Row label="AI-style lab" c={r.ai} />
                <Row label="Engine + lab blend" c={r.blend} />
                <Row label="Baseline: always home" c={r.baselines.alwaysHome} />
                <Row label="Baseline: league base rates" c={r.baselines.frequency} />
                <Row label="Baseline: coin-flip thirds" c={r.baselines.uniform} />
                {r.baselines.lowestOdds ? <Row label="Baseline: lowest verified odds" c={r.baselines.lowestOdds} /> : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Skill vs base rates (0 = no better than guessing by frequency): engine {num(r.skill.engine)}, lab {num(r.skill.ai)}, blend {num(r.skill.blend)}.
          </p>
          <div>
            <h3 className="font-medium">Accuracy by verified result</h3>
            <p className="mt-1 text-xs text-muted">Recall within each actual result class; n/a means no completed examples of that class.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(["home", "draw", "away"] as const).map((outcome) => (
                <div key={outcome} className="rounded-card border border-line bg-raised p-2 text-xs">
                  <p className="font-medium">{outcome === "home" ? "Home wins (1)" : outcome === "draw" ? "Draws (X)" : "Away wins (2)"}</p>
                  <p className="mt-1 text-muted">Engine {pc(r.outcomes.engine[outcome].accuracy)} · AI {pc(r.outcomes.ai[outcome].accuracy)}</p>
                  <p className="mt-1 text-muted">Published {pc(r.outcomes.primary[outcome].accuracy)} · n={r.outcomes.primary[outcome].n}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium">Does agreement mean accuracy?</h3>
            <p className="mt-1 text-xs text-muted">
              Models agreed on {r.agreement.agree.n} matches ({pc(r.agreement.agree.hitRate)} correct) and disagreed on {r.agreement.disagree.n} ({pc(r.agreement.disagree.hitRate)} correct).
              {Number.isFinite(r.agreement.liftPoints)
                ? r.agreement.liftPoints > 5 && r.n >= MIN_SAMPLE
                  ? ` Agreement is associated with ${r.agreement.liftPoints.toFixed(1)} points higher accuracy in this sample.`
                  : " That gap is too small or too uncertain to treat agreement as a sign of being right."
                : " Not enough matches on both sides to say."}
            </p>
          </div>
          {r.confidence.length ? (
            <div>
              <h3 className="font-medium">Accuracy by stated confidence</h3>
              <ul className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {r.confidence.map((b) => (
                  <li key={b.label}>{b.label}: {pc(b.card.hitRate)} correct over {b.card.n} matches</li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.calibration.length ? (
            <div>
              <h3 className="font-medium">Calibration</h3>
              <p className="mt-1 text-xs text-muted">When the blend says X%, how often does that outcome really happen?</p>
              <ul className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {r.calibration.map((b) => (
                  <li key={b.from} className="tabular-nums">
                    Said {pc(b.predicted)} → happened {pc(b.observed)} ({b.n} outcomes)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            Limit: the stored probabilities come from the bundled fixture statistics, so this proves the model's track record on those
            matches, not that picks were locked in before kick-off. A past hit rate does not guarantee future results.
          </p>
        </div>
      ) : null}
    </section>
  );
}
