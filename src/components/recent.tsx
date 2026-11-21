import { useCallback, useEffect, useMemo, useState } from "react";
import { formatOdds, pct } from "@/lib/format";
import { actualSide, quoteAt, RECENT, type SettledMatch } from "@/lib/price";
import { getResultLedger, type ResultLedgerRow } from "@/lib/signals-fn";
import { buildAdvancedReport } from "@/lib/advanced-predictors";
import { useDesk } from "@/lib/desk-store";

type ResultItem = {
  id: string;
  date: string;
  league: string;
  category: string;
  code: string;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  pick: "home" | "draw" | "away";
  probabilities: { home: number; draw: number; away: number };
  result: "home" | "draw" | "away";
  source: string;
  jackpot: boolean;
  predictionRecorded: boolean;
  modelResults?: { name: string; pick: "home" | "draw" | "away"; correct: boolean }[];
  match?: SettledMatch;
};

const sideLabel = (side: ResultItem["result"]) => side === "home" ? "1 · Home" : side === "draw" ? "X · Draw" : "2 · Away";

function competitionCategory(league: string, code?: string) {
  const value = `${code ?? ""} ${league}`.toLowerCase();
  if (/epl|premier league|english premier/.test(value)) return "EPL";
  if (/champions league|europa league|conference league|uefa|ucl|uel|uec/.test(value)) return "UEFA";
  if (/la liga|laliga|primera division/.test(value)) return "LALIGA";
  if (/bundesliga|german/.test(value)) return "BUNDESLIGA";
  if (/serie a|italian/.test(value)) return "SERIE A";
  if (/ligue 1|french/.test(value)) return "LIGUE 1";
  if (/eredivisie|dutch/.test(value)) return "EREDIVISIE";
  if (/championship|england 2/.test(value)) return "CHAMPIONSHIP";
  return code?.trim().toUpperCase() || "OTHER";
}

function catalogueItem(match: SettledMatch): ResultItem {
  const result = actualSide(match);
  const modelResults = buildAdvancedReport(match.home, match.away).models.map((model) => {
    const pick = (["home", "draw", "away"] as const).reduce((best, side) => model.probabilities[side] > model.probabilities[best] ? side : best, "home" as "home" | "draw" | "away");
    return { name: model.name, pick, correct: pick === result };
  });
  return {
    id: match.id,
    date: match.playedLabel,
    league: match.league,
    category: competitionCategory(match.league, match.code),
    code: match.code,
    home: match.home.name,
    away: match.away.name,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    pick: match.likely.market as ResultItem["pick"],
    probabilities: { home: match.model.home, draw: match.model.draw, away: match.model.away },
    result,
    source: "Built-in historical results",
    jackpot: /jackpot|betika/i.test(`${match.id} ${match.league}`),
    predictionRecorded: true,
    modelResults,
    match,
  };
}

function ledgerItem(row: ResultLedgerRow): ResultItem {
  return {
    id: row.id,
    date: row.kickoffAt.slice(0, 10),
    league: row.league,
    category: competitionCategory(row.league),
    code: row.league,
    home: row.home,
    away: row.away,
    homeGoals: row.homeGoals,
    awayGoals: row.awayGoals,
    pick: row.pick,
    probabilities: row.probabilities,
    result: row.result,
    source: row.resultSource ?? "Verified result feed",
    jackpot: row.jackpot,
    predictionRecorded: row.predictionRecorded,
    modelResults: row.modelResults,
  };
}

export function Recent() {
  const league = useDesk((s) => s.league);
  const query = useDesk((s) => s.query);
  const bookId = useDesk((s) => s.bookId);
  const oddsFormat = useDesk((s) => s.oddsFormat);
  const setOpen = useDesk((s) => s.setOpen);
  const [ledger, setLedger] = useState<ResultLedgerRow[]>([]);
  const [mode, setMode] = useState<"all" | "jackpot">("all");
  const [selectedDate, setSelectedDate] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setSyncError(false);
    void getResultLedger()
      .then((rows) => { setLedger(rows); setLastSynced(new Date()); })
      .catch(() => setSyncError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const allItems = useMemo(() => [
    ...ledger.map(ledgerItem),
    ...RECENT.map(catalogueItem).filter((item) => !ledger.some((row) => row.id === item.id)),
  ].sort((a, b) => b.date.localeCompare(a.date)), [ledger]);
  const dates = useMemo(() => [...new Set(allItems.map((item) => item.date))].sort((a, b) => b.localeCompare(a)), [allItems]);
  const isoToday = new Date().toISOString().slice(0, 10);
  const isoYesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const categories = useMemo(() => [...new Set(allItems.map((item) => item.category))].sort(), [allItems]);
  const q = query.trim().toLowerCase();
  const rows = allItems.filter((item) => {
    if (mode === "jackpot" && !item.jackpot) return false;
    if (selectedDate !== "ALL" && item.date !== selectedDate) return false;
    if (selectedCategory !== "ALL" && item.category !== selectedCategory) return false;
    if (league !== "ALL" && item.code !== league && item.league !== league) return false;
    if (!q) return true;
    return `${item.home} ${item.away} ${item.league}`.toLowerCase().includes(q);
  });
  const hit = rows.filter((item) => item.result === item.pick).length;
  const exactScores = rows.filter((item) => item.homeGoals !== null && item.awayGoals !== null && item.match?.homeGoals === item.homeGoals && item.match?.awayGoals === item.awayGoals).length;
  const outcomeCounts = (['home', 'draw', 'away'] as const).map((outcome) => ({ outcome, total: rows.filter((item) => item.result === outcome).length, landed: rows.filter((item) => item.result === outcome && item.pick === outcome).length }));
  const groupedDates = [...new Set(rows.map((item) => item.date))];
  const latestVerifiedDate = dates[0] ?? null;
  const coverageGap = latestVerifiedDate ? Math.floor((Date.now() - Date.parse(`${latestVerifiedDate}T23:59:59Z`)) / 86400000) : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-4xl">Results</h1>
        <p className="mt-2 max-w-3xl text-pretty text-muted">
          View every available completed result with the recorded prediction, probability and final outcome attached. Verified database results are combined with the existing historical catalogue; the system never turns an unsettled fixture into a result.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Result filters">
          {(["all", "jackpot"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setMode(value)} className={`h-10 rounded-full border px-4 text-sm ${mode === value ? "border-signal bg-signal text-ink" : "border-line"}`}>
              {value === "all" ? `All results (${allItems.length})` : `Jackpot results (${allItems.filter((item) => item.jackpot).length})`}
            </button>
          ))}
          <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-fg" aria-label="Select result date">
            <option value="ALL">All previous dates</option>
            {dates.map((date) => <option key={date} value={date}>{date}</option>)}
          </select>
          {[ [isoToday, "Today"], [isoYesterday, "Yesterday"] ].map(([date, label]) => (
            <button key={date} type="button" onClick={() => setSelectedDate(date)} className={`h-10 rounded-full border px-3 text-sm ${selectedDate === date ? "border-signal bg-signal text-ink" : "border-line"}`}>
              {label}
            </button>
          ))}
          <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-fg" aria-label="Select competition category">
            <option value="ALL">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button type="button" onClick={refresh} disabled={loading} className="h-10 rounded-full border border-signal px-4 text-sm text-signal disabled:opacity-50">{loading ? "Syncing…" : "Refresh scores"}</button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Prediction record" value={`${hit}/${rows.length}`} detail="landed in this filter" />
        <Stat label="Exact score" value={`${exactScores}`} detail="catalogue score matches" />
        <Stat label="Dates covered" value={`${groupedDates.length}`} detail="completed match dates" />
        <Stat label="Last sync" value={lastSynced ? lastSynced.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} detail={syncError ? "sync needs attention" : "verified feed check"} />
      </div>
      <div className="flex flex-wrap gap-2 rounded-card border border-line bg-surface p-3 text-xs text-muted">
        {outcomeCounts.map(({ outcome, total, landed }) => <span key={outcome} className="rounded-full border border-line px-3 py-1">{sideLabel(outcome)}: {landed}/{total}</span>)}
        {syncError ? <span className="rounded-full border border-red-400/60 px-3 py-1 text-red-200">Unable to refresh verified scores; showing last successful data.</span> : <span className="rounded-full border border-signal/50 px-3 py-1 text-signal">Auto-refresh every 5 minutes</span>}
      </div>
      {coverageGap !== null && coverageGap > 1 ? (
        <section className="rounded-card border border-amber-400/60 bg-amber-950/30 p-3 text-sm text-amber-100" aria-label="Verified result coverage warning">
          <p className="font-semibold">Verified result coverage ends at {latestVerifiedDate}</p>
          <p className="mt-1 text-xs text-amber-100/80">Newer dates are never invented or marked final. Results now query API-Football for the latest dates and also merge football-data.org, OpenFootball, ESPN, and settled database records. A date appears only when at least one source publishes a completed score.</p>
        </section>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-muted">{loading ? "Checking verified results…" : "No completed result matches this filter yet."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((item) => <ResultRow key={item.id} item={item} bookId={bookId} oddsFormat={oddsFormat} onOpen={item.match ? () => setOpen(item.id) : undefined} />)}
        </div>
      )}
    </div>
  );
}

function ResultRow({ item, bookId, oddsFormat, onOpen }: { item: ResultItem; bookId: ReturnType<typeof useDesk.getState>["bookId"]; oddsFormat: ReturnType<typeof useDesk.getState>["oddsFormat"]; onOpen?: () => void }) {
  const landed = item.result === item.pick;
  const content = (
    <>
      <p className="font-display text-3xl tabular-nums">{item.homeGoals === null || item.awayGoals === null ? "—" : `${item.homeGoals}–${item.awayGoals}`}</p>
      <div>
        <p className="text-sm text-muted">{item.category} · {item.league} · {item.date} · {item.jackpot ? "Jackpot result" : item.source}</p>
        <p className="font-medium">{item.home} v {item.away}</p>
        <p className="text-sm text-muted">Prediction: {sideLabel(item.pick)} ({pct(item.probabilities[item.pick])}) · Final: {sideLabel(item.result)}</p>
        <p className={`mt-1 text-xs ${item.predictionRecorded ? "text-signal" : "text-amber-200"}`}>{item.predictionRecorded ? "Prediction frozen before kickoff" : "Score recorded; no pre-kickoff prediction was logged"}</p>
        {item.modelResults?.length ? (
          <details className="mt-2 rounded border border-line bg-bg/40 px-2 py-1 text-xs">
            <summary className="cursor-pointer text-muted">Correct models: {item.modelResults.filter((model) => model.correct).length}/{item.modelResults.length}</summary>
            <p className="mt-1 text-signal">{item.modelResults.filter((model) => model.correct).map((model) => model.name).join(", ") || "No individual model matched"}</p>
          </details>
        ) : null}
      </div>
      <p className={"text-sm " + (landed ? "text-signal" : "text-muted")}>
        {landed ? "Prediction landed" : "Prediction missed"}
        {item.match ? <span className="mt-1 block tabular-nums text-fg">{quoteAt(item.match, bookId, item.pick).book} {formatOdds(quoteAt(item.match, bookId, item.pick).odds, oddsFormat)}</span> : <span className="mt-1 block text-xs text-muted">Verified score attached</span>}
      </p>
    </>
  );
  return onOpen ? <button type="button" onClick={onOpen} className="grid w-full gap-3 rounded-card border border-line bg-surface p-4 text-left md:grid-cols-[auto_1fr_auto] md:items-center">{content}</button> : <div className="grid w-full gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-[auto_1fr_auto] md:items-center">{content}</div>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-card border border-line bg-surface p-3"><p className="text-[11px] uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted">{detail}</p></div>;
}
