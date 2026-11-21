import { useMemo, useState, type SyntheticEvent } from "react";
import { pct } from "@/lib/format";
import {
  buildAdvancedReport,
  predictorPickLabel,
  predictorShortLabel,
} from "@/lib/advanced-predictors";
import { lookupSportPesaReference, type SportPesaReference } from "@/lib/odds-reference";
import type { PricedMatch } from "@/lib/price";
import { useConsensus } from "@/lib/use-consensus";
import { ConsensusBadge } from "@/components/consensus-badge";
import type { SignalReply } from "@/lib/signals-fn";

export function PredictionLab({ match, odds }: { match: PricedMatch; odds?: { home: number; draw: number; away: number } }) {
  const consensus = useConsensus(match.id, match.home, match.away, { odds, league: match.league });
  const report = useMemo(
    () => buildAdvancedReport(match.home, match.away),
    [match.home, match.away],
  );
  const [sourceCheck, setSourceCheck] = useState<SportPesaReference | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const pickName = predictorPickLabel(report.pick, match.home.short, match.away.short);
  const pickProbability = report.ensemble[report.pick];
  const pickRange = report.models.map((model) => model.probabilities[report.pick]);
  const lower = Math.min(...pickRange);
  const upper = Math.max(...pickRange);
  const alignment =
    report.agreementRate >= 0.7
      ? "Broad alignment"
      : report.agreementRate >= 0.5
        ? "Mixed"
        : "Split";

  async function checkPublicSource() {
    if (sourceLoading || sourceCheck) return;
    setSourceLoading(true);
    setSourceError(false);
    try {
      setSourceCheck(await lookupSportPesaReference({ data: match.id }));
    } catch {
      setSourceError(true);
    } finally {
      setSourceLoading(false);
    }
  }

  async function refreshLiveData() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(false);
    try { await consensus.refreshSignals(); }
    catch { setRefreshError(true); }
    finally { setRefreshing(false); }
  }

  function onLabToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) void checkPublicSource();
  }

  return (
    <div className="flex flex-col gap-2">
    <ConsensusBadge c={consensus} home={match.home.short} away={match.away.short} />
    <details className="rounded-card border border-line bg-raised p-3" onToggle={onLabToggle}>
      <summary className="cursor-pointer list-none text-sm font-medium">
        <span className="text-signal">AI-style lab (input to the final tip)</span>
        <span className="ml-2 text-fg">
          {pickName} · {pct(pickProbability)}
        </span>
        <span className="ml-2 text-muted">
          {report.agreement}/{report.models.length} models
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric label="Ensemble lean" value={pickName} />
          <Metric label="Model probability" value={pct(pickProbability)} />
          <Metric
            label="Agreement"
            value={`${report.agreement}/${report.models.length} · ${alignment}`}
          />
          <Metric
            label="Sample coverage"
            value={`${report.sampleGames} games · ${report.sampleLabel}`}
          />
          <Metric label="Lead over 2nd result" value={pct(report.outcomeMargin)} />
        </div>

        <div className="rounded-card border border-line bg-surface p-3">
          <p className="text-sm font-medium">25 local predictor models</p>
          <p className="mt-1 text-xs text-muted">
            Twenty-five formula-based predictors are compared. Six additional scenario models
            broaden the sensitivity checks. Each row shows home / draw / away probabilities. These
            formulas share inputs and are not independent votes; scenario variants are downweighted
            so they cannot dominate the ensemble. The result is not a trained or historically
            calibrated model.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {report.models.map((model) => (
              <li
                key={model.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-t border-line pt-2 first:border-0 first:pt-0"
              >
                <div>
                  <p className="text-sm text-fg">{model.name}</p>
                  <p className="text-xs text-muted">{model.method}</p>
                </div>
                <p className="whitespace-nowrap text-right text-xs tabular-nums text-muted">
                  {pct(model.probabilities.home)} / {pct(model.probabilities.draw)} /{" "}
                  {pct(model.probabilities.away)}
                  <span className="block text-fg">
                    Lean: {predictorShortLabel(topPick(model.probabilities))}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-card border border-line bg-surface p-3">
          <p className="text-sm font-medium">17 additional match tools</p>
          <p className="mt-1 text-xs text-muted">
            The top-result margin and recent-form volatility checks are new. Diagnostics are outputs
            from the same fixture data, not extra independent predictors or betting recommendations.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.tools.map((tool) => (
              <li key={tool.id} className="rounded-card border border-line bg-raised p-2">
                <p className="text-xs text-muted">{tool.name}</p>
                <p className="mt-1 text-sm font-medium tabular-nums text-fg">{tool.value}</p>
                <p className="mt-1 text-xs text-muted">{tool.method}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-card border border-line bg-surface p-3">
            <p className="text-sm font-medium">Probability dispersion</p>
            <p className="mt-1 text-sm text-muted">
              For {pickName}, the {report.models.length} models range from {pct(lower)} to{" "}
              {pct(upper)}
              (spread {pct(report.spread)}). This is model disagreement, not a statistical
              confidence interval.
            </p>
          </div>
          <div className="rounded-card border border-line bg-surface p-3">
            <p className="text-sm font-medium">±10% xG stress test</p>
            <p className="mt-1 text-sm text-muted">
              Lean {report.stressStable ? "stays the same" : "changes"} across low-attack, baseline,
              and high-attack scenarios:{" "}
              {report.stressPicks
                .map((pick) => predictorPickLabel(pick, match.home.short, match.away.short))
                .join(" · ")}
              .
            </p>
          </div>
        </div>

        <PublicOddsReference
          result={sourceCheck}
          loading={sourceLoading}
          failed={sourceError}
          onCheck={() => void checkPublicSource()}
        />

        <LiveDataStatus signal={consensus.providerSignals} refreshing={refreshing} failed={refreshError} onRefresh={() => void refreshLiveData()} />

        <div className="rounded-card border border-line bg-surface p-3">
          <p className="text-sm font-medium">Risk and data checks</p>
          {report.riskFlags.length ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
              {report.riskFlags.map((flag) => (
                <li key={flag}>• {flag}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">
              No configured sample-size, agreement, spread, draw, or stress-test warning triggered.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            Calibration status: not backtested by predictor. These deterministic algorithms use this
            app’s fixture stats; they are not separate external AI services, live team-news models,
            or bookmaker prices. Agreement is not accuracy.
          </p>
        </div>
      </div>
    </details>
    </div>
  );
}

function LiveDataStatus({ signal, refreshing, failed, onRefresh }: { signal: SignalReply | null; refreshing: boolean; failed: boolean; onRefresh: () => void }) {
  const freshness = signal?.freshness;
  return (
    <section className="rounded-card border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Live data and freshness gate</p>
          <p className="mt-1 text-xs text-muted">
            {freshness ? `${freshness.status.toUpperCase()} · ${freshness.action.toUpperCase()} · ${freshness.ageHours === null ? "age unknown" : `${freshness.ageHours.toFixed(1)} h`}` : "Checking configured sources…"}
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="h-10 rounded-full border border-line px-3 text-sm disabled:opacity-50">
          {refreshing ? "Refreshing…" : "Refresh live data / lineups"}
        </button>
      </div>
      {freshness?.reasons.length ? <ul className="mt-2 list-disc pl-5 text-xs text-muted">{freshness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {failed ? <p className="mt-2 text-xs text-[#EF4444]">The refresh failed; the existing forecast and log were not changed.</p> : null}
      {signal?.featureStatus?.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {signal.featureStatus.map((feature) => {
            const color = feature.status === "ready" ? "#10B981" : feature.status === "stale" ? "#F59E0B" : feature.status === "diagnostic" ? "#06B6D4" : "#EF4444";
            return <li key={feature.id} className="rounded-card border border-line bg-raised p-2 text-xs">
              <p className="font-medium" style={{ color }}>{feature.id.replaceAll("-", " ")} · {feature.status}</p>
              <p className="mt-1 text-muted">{feature.detail}</p>
            </li>;
          })}
        </ul>
      ) : null}
      {signal?.lineups ? <p className="mt-2 text-xs" style={{ color: signal.lineups.status === "confirmed" ? "#10B981" : "#F59E0B" }}>
        Lineups: {signal.lineups.status} · {signal.lineups.homeStarters}/{signal.lineups.awayStarters} starters · observed {new Date(signal.lineups.observedAt).toLocaleTimeString()}.
      </p> : null}
      {signal?.weather ? <p className="mt-2 text-xs text-[#06B6D4]">
        Weather diagnostic for {new Date(signal.weather.validAt).toLocaleString()}: {signal.weather.temperatureC === undefined ? "temperature n/a" : `${signal.weather.temperatureC}°C`}, {signal.weather.precipitationMm === undefined ? "rain n/a" : `${signal.weather.precipitationMm} mm/h`}, {signal.weather.windKmh === undefined ? "wind n/a" : `${signal.weather.windKmh} km/h`}. {signal.weather.diagnostics.join(" ")}
        {" "}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Weather data by Open-Meteo</a>.
      </p> : null}
      {freshness?.action === "pass" ? <p className="mt-2 text-sm font-medium text-[#F59E0B]">LOW confidence: required current team data could not be verified; the final selection uses the available baseline evidence.</p> : null}
      <p className="mt-2 text-[11px] text-muted">Late lineups are requested on refresh within 90 minutes of a verified kickoff and saved as a separate observation; the original forecast stays frozen.</p>
    </section>
  );
}

function topPick(probabilities: { home: number; draw: number; away: number }) {
  if (probabilities.home >= probabilities.draw && probabilities.home >= probabilities.away)
    return "home";
  if (probabilities.away >= probabilities.draw) return "away";
  return "draw";
}

function PublicOddsReference({
  result,
  loading,
  failed,
  onCheck,
}: {
  result: SportPesaReference | null;
  loading: boolean;
  failed: boolean;
  onCheck: () => void;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-3">
      <p className="text-sm font-medium">Public odds source check</p>
      <p className="mt-1 text-xs text-muted">
        SportPesa is checked against a public third-party comparison page only when this lab opens.
        Its prices may be delayed and are not guaranteed live or official.
      </p>
      {!result && !loading ? (
        <button
          type="button"
          onClick={onCheck}
          className="mt-2 h-10 rounded-full border border-line px-3 text-sm"
        >
          {failed ? "Retry public-source check" : "Check public SportPesa reference"}
        </button>
      ) : null}
      {loading ? <p className="mt-2 text-sm text-muted">Checking the exact fixture page…</p> : null}
      {failed ? (
        <p className="mt-2 text-sm text-muted">
          The public-source check failed; no quote is shown.
        </p>
      ) : null}
      {result ? (
        <div className="mt-2 flex flex-col gap-2">
          {result.odds ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="SportPesa reference · 1" value={result.odds.home.toFixed(2)} />
              <Metric label="X" value={result.odds.draw.toFixed(2)} />
              <Metric label="2" value={result.odds.away.toFixed(2)} />
            </div>
          ) : null}
          <p className="text-sm text-muted">{result.detail}</p>
          <p className="text-xs text-muted">
            {result.freshness} Checked {new Date(result.checkedAt).toLocaleTimeString()} local time.
          </p>
          {result.sourceUrl ? (
            <a
              href={result.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-signal underline"
            >
              Verify this fixture at the comparison source
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 border-t border-line pt-2">
        <p className="text-sm text-muted">
          1xBet: no automated quote is shown. Its public page is not reliably readable here, and
          available bookmaker-specific aggregators prohibit automated reuse unless permission is
          granted.
        </p>
        <a
          href="https://1xbet.com/en/line/football"
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-sm text-signal underline"
        >
          Open 1xBet directly
        </a>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-raised px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums text-fg">{value}</p>
    </div>
  );
}
