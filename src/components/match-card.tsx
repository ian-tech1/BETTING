import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { FormPills, SplitBar } from "@/components/bits";
import { PredictionLab } from "@/components/prediction-lab";
import { matchMarks } from "@/lib/engines";
import { useNow } from "@/components/use-now";
import { countdown, formatOdds, pct, riskBand, signedEv, units } from "@/lib/format";
import { focusedMarket } from "@/lib/filter-matches";
import {
  BOOKS,
  doubleChance,
  fairOdds,
  kickoffMs,
  quoteAt,
  selectionName,
  suggestedStake,
  tapeOdds,
  type Edge,
  type MarketKey,
  type PricedMatch,
} from "@/lib/price";
import { useDesk } from "@/lib/desk-store";
import { lookupBoardOdds, type BoardOddsComparison } from "@/lib/bookmaker-odds";
import { useConsensus } from "@/lib/use-consensus";

type OddsSource = "demo" | "betika" | "sportpesa" | "manual";

export function MatchCard({ match }: { match: PricedMatch }) {
  const [oddsSource, setOddsSource] = useState<OddsSource>("betika");
  const [publicOdds, setPublicOdds] = useState<BoardOddsComparison | null>(null);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState(false);
  const [manualOddsInput, setManualOddsInput] = useState({ home: "", draw: "", away: "" });
  const bookId = useDesk((s) => s.bookId);
  const oddsFormat = useDesk((s) => s.oddsFormat);
  const marketFocus = useDesk((s) => s.marketFocus);
  const bankroll = useDesk((s) => s.bankroll);
  const watch = useDesk((s) => s.watch);
  const toggleWatch = useDesk((s) => s.toggleWatch);
  const setOpen = useDesk((s) => s.setOpen);
  const setPreview = useDesk((s) => s.setPreview);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const legs = useDesk((s) => s.legs);
  const setQuote = useDesk((s) => s.setQuote);
  const typed = useDesk((s) => s.quotes[`${match.id}:${focusedMarket(match, marketFocus)}`]);
  const { now, bucket } = useNow();

  async function loadPublicOdds() {
    if (oddsLoading || publicOdds) return;
    setOddsLoading(true);
    setOddsError(false);
    try {
      setPublicOdds(await lookupBoardOdds({ data: match.id }));
    } catch {
      setOddsError(true);
    } finally {
      setOddsLoading(false);
    }
  }

  const market = focusedMarket(match, marketFocus);
  const quote = quoteAt(match, bookId, market);
  const manualValues = {
    home: Number(manualOddsInput.home),
    draw: Number(manualOddsInput.draw),
    away: Number(manualOddsInput.away),
  };
  const manualTriple = Object.values(manualValues).every(
    (value) => Number.isFinite(value) && value > 1.01 && value <= 100,
  )
    ? manualValues
    : undefined;
  const liveTriple =
    oddsSource === "betika"
      ? publicOdds?.betika.odds
      : oddsSource === "sportpesa"
        ? publicOdds?.sportpesa.odds
        : oddsSource === "manual"
          ? manualTriple
          : undefined;
  const liveCurrent =
    market === "home" || market === "draw" || market === "away" ? liveTriple?.[market] ?? match.verifiedOdds?.[market] : undefined;
  const currentPrice =
    oddsSource === "demo"
      ? now === null
        ? quote.odds
        : tapeOdds(quote.odds, `${match.id}:${market}:${bookId}`, bucket)
      : liveCurrent;
  const isDemo = oddsSource === "demo";
  const shown = (isDemo ? (typed ?? currentPrice) : currentPrice) ?? Number.NaN;
  const selectedSourceName =
    match.verifiedOddsSource ??
    oddsSource === "betika"
      ? "Betika public quote"
      : oddsSource === "sportpesa"
        ? "SportPesa comparison snapshot"
        : oddsSource === "manual"
          ? `manually entered ${BOOKS.find((book) => book.id === bookId)?.name ?? "bookmaker"} price`
          : "demo estimate";
  const fair = fairOdds(match.model[market]);
  const dc = doubleChance(match);
  const kick = kickoffMs(match.id);
  const home = quoteAt(match, bookId, "home");
  const draw = quoteAt(match, bookId, "draw");
  const away = quoteAt(match, bookId, "away");
  const boardOdds = match.verifiedOdds;
  const final = useConsensus(match.id, match.home, match.away, {
    odds: match.verifiedOdds,
    league: match.league,
  });
  const finalNumber = final.pick === "home" ? "1" : final.pick === "draw" ? "X" : "2";
  const show1x2 = (pick: "home" | "draw" | "away", n: number, seed: string) => {
    const price =
      oddsSource === "demo" ? (now === null ? n : tapeOdds(n, seed, bucket)) : liveTriple?.[pick] ?? match.verifiedOdds?.[pick];
    return price ? formatOdds(price, oddsFormat) : "—";
  };
  const edgeForStake: Edge = {
    ...match.likely,
    market,
    model: match.model[market],
    odds: Number.isFinite(shown) ? shown : 0,
    ev: Number.isFinite(shown) ? match.model[market] * shown - 1 : Number.NEGATIVE_INFINITY,
    edge: quote.edge,
    book: quote.book,
    bookId: quote.bookId,
  };
  const stake = isDemo ? suggestedStake(edgeForStake, bankroll) : 0;
  const onSlip = legs.some((leg) => leg.matchId === match.id && leg.market === market);
  useEffect(() => {
    if (!onSlip && final.tier !== "PASS") toggleLeg(match.id, final.pick);
  }, [final.pick, final.tier, match.id, onSlip, toggleLeg]);
  const marks = matchMarks(match.lambdaHome, match.lambdaAway);
  const injury = [...match.home.out, ...match.away.out].find(
    (item) => !/no new|no senior|no confirmed/i.test(item),
  );
  const points = (form: typeof match.home.form) =>
    form.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
  const cornerOver = (line: number) =>
    1 -
    Array.from({ length: line + 1 }, (_, k) => {
      let p = Math.exp(-match.extras.corners);
      for (let i = 1; i <= k; i++) p *= match.extras.corners / i;
      return p;
    }).reduce((a, b) => a + b, 0);
  const yellowOver =
    1 -
    Array.from({ length: 4 }, (_, k) => {
      let p = Math.exp(-match.extras.yellows);
      for (let i = 1; i <= k; i++) p *= match.extras.yellows / i;
      return p;
    }).reduce((a, b) => a + b, 0);
  const dnb = (side: number, other: number) => 1 / Math.max(0.05, side / (side + other));
  const marketOverround = boardOdds ? (1 / boardOdds.home + 1 / boardOdds.draw + 1 / boardOdds.away) * 100 : null;
  const accuracyChecks = [
    ["Form", `${points(match.home.form)}–${points(match.away.form)}`],
    ["xG gap", `${(match.lambdaHome - match.lambdaAway).toFixed(2)}`],
    ["Market", marketOverround === null ? "Unavailable" : `${marketOverround.toFixed(0)}% margin`],
    ["Availability", injury ? "Caution" : "Clear"],
    ["Consensus", final.enginePick === final.aiPick ? "Aligned" : "Split"],
  ] as const;

  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-[#142019] p-3 shadow-[0_12px_30px_rgba(0,0,0,0.18)] sm:p-4">
      <div className="flex items-start justify-between gap-3 text-sm text-muted">
        <p>
          {match.code} · {match.dateLabel} · {match.time} UK
          {now !== null && kick !== null ? ` · ${countdown(kick, now)}` : ""}
        </p>
        <button
          type="button"
          aria-label={watch.includes(match.id) ? "Remove from watchlist" : "Add to watchlist"}
          onClick={() => toggleWatch(match.id)}
          className={
            "flex size-11 items-center justify-center rounded-full border border-line " +
            (watch.includes(match.id) ? "text-signal" : "text-muted")
          }
        >
          <Star className="size-4" fill={watch.includes(match.id) ? "currentColor" : "none"} />
        </button>
      </div>

      <div>
        <p className="font-medium">{match.home.name}</p>
        <FormPills form={match.home.form} />
        <p className="mt-1 text-[11px] text-muted">Last five verified results · {match.home.form.length}/5 available · Home form: {match.home.venueForm?.length ? match.home.venueForm.join(" – ") : "unavailable"} · Last five goals: {match.home.recentGoalsFor !== undefined ? `${match.home.recentGoalsFor} scored, ${match.home.recentGoalsAgainst} conceded` : "unavailable"}</p>
        <p className="mt-2 font-medium">{match.away.name}</p>
        <FormPills form={match.away.form} />
        <p className="mt-1 text-[11px] text-muted">Last five verified results · {match.away.form.length}/5 available · Away form: {match.away.venueForm?.length ? match.away.venueForm.join(" – ") : "unavailable"} · Last five goals: {match.away.recentGoalsFor !== undefined ? `${match.away.recentGoalsFor} scored, ${match.away.recentGoalsAgainst} conceded` : "unavailable"}</p>
        <p className="mt-2 text-sm text-muted">
          {match.home.form.length && match.away.form.length
            ? `Last five count more than the season. ${match.home.short} ${points(match.home.form)} pts, ${match.away.short} ${points(match.away.form)} pts.`
            : "Recent form and team-history data are unavailable for this provider fixture."} {namedOut(match.home)} {namedOut(match.away)}
        </p>
        <div className="mt-2 rounded-card border border-line bg-bg p-2 text-xs">
          <p className="font-medium">Player availability</p>
          <p className="mt-1 text-muted">{namedOut(match.home)} {namedOut(match.away)}</p>
          <p className="mt-1 text-muted">Injured or missing players are included as a caution signal when listed.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-card bg-raised p-3">
        <div>
          <p className="text-xs text-muted">Home xG</p>
          <p className="font-display text-2xl tabular-nums">{match.home.played > 0 ? match.lambdaHome.toFixed(2) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Away xG</p>
          <p className="font-display text-2xl tabular-nums">{match.away.played > 0 ? match.lambdaAway.toFixed(2) : "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Score</p>
          <p className="font-display text-2xl tabular-nums">{match.home.played > 0 && match.away.played > 0 ? match.score : "—"}</p>
        </div>
      </div>

      <SplitBar match={match} />
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5" aria-label="Five accuracy checks">
        {accuracyChecks.map(([label, value]) => (
          <div key={label} className="rounded-card border border-line bg-raised px-2 py-2">
            <p className="text-muted">{label}</p>
            <p className="mt-1 font-medium text-fg">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-card border-2 border-red-400/70 bg-red-950/30 p-3" role="status" aria-label="Unified AI game prediction and odds">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-300">Unified final prediction</p>
            <p className="mt-1 text-lg font-semibold">FINAL AI PREDICTION: {finalNumber} · {selectionName(match, final.pick)}</p>
          </div>
          <p className="text-right text-xs text-muted">{Math.round(final.probabilities[final.pick] * 100)}% probability · {final.insufficientData ? "LOW" : final.tier} confidence<br />Estimated score: {match.home.played > 0 && match.away.played > 0 ? match.score : "Baseline unavailable"}</p>
        </div>
        <p className="mt-2 text-xs text-muted">Why: {final.label}. The final outcome is the highest of the independently calculated Home, Draw and Away probabilities.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px] sm:grid-cols-4">
          <div className="rounded-card border border-line bg-bg/60 px-2 py-2"><p className="text-muted">Agreement</p><p className="mt-1 font-semibold">{final.enginePick === final.aiPick ? "Aligned" : "Split"}</p></div>
          <div className="rounded-card border border-line bg-bg/60 px-2 py-2"><p className="text-muted">Confidence</p><p className="mt-1 font-semibold">{Math.round(final.band.stability * 100)}%</p></div>
          <div className="rounded-card border border-line bg-bg/60 px-2 py-2"><p className="text-muted">Risk</p><p className="mt-1 font-semibold">{Number.isFinite(shown) ? riskBand(shown) : "Unavailable"}</p></div>
          <div className="rounded-card border border-line bg-bg/60 px-2 py-2"><p className="text-muted">Model picks</p><p className="mt-1 font-semibold">{final.enginePick === final.aiPick ? "2 aligned" : "Split"}</p></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              {(["home", "draw", "away"] as const).map((pick) => (
              <button key={pick} type="button" onClick={() => toggleLeg(match.id, pick)} className={`rounded-card border px-2 py-2 ${final.pick === pick ? "border-red-300 bg-red-500/30 text-red-100" : "border-line bg-bg text-muted"}`} aria-pressed={onSlip && final.pick === pick}>
              {pick === "home" ? "1" : pick === "draw" ? "X" : "2"} · {pick === "home" ? match.home.short : pick === "away" ? match.away.short : "Draw"}{final.pick === pick ? " · AI PICK" : ""}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-red-100/80">All three outcomes are calculated independently. Only the highest-probability outcome is selected. LOW confidence means limited verified evidence.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-card border border-line px-2 py-2"><p className="text-muted">1 · {match.home.short}</p><p className="mt-1 text-base font-semibold tabular-nums">{show1x2("home", home.odds, `${match.id}:home:${bookId}`)}</p></div>
          <div className="rounded-card border border-line px-2 py-2"><p className="text-muted">X · Draw</p><p className="mt-1 text-base font-semibold tabular-nums">{show1x2("draw", draw.odds, `${match.id}:draw:${bookId}`)}</p></div>
          <div className="rounded-card border border-line px-2 py-2"><p className="text-muted">2 · {match.away.short}</p><p className="mt-1 text-base font-semibold tabular-nums">{show1x2("away", away.odds, `${match.id}:away:${bookId}`)}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-muted">Odds shown from {match.verifiedOddsSource ?? BOOKS.find((book) => book.id === bookId)?.name ?? "selected bookmaker"}{match.verifiedOddsCheckedAt ? ` · updated ${new Date(match.verifiedOddsCheckedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })} UTC` : " · verified quote unavailable"}.</p>
      </div>
      <details className="rounded-card border border-line bg-raised p-3">
        <summary className="cursor-pointer list-none text-sm font-medium">Advanced prediction detail</summary>
        <div className="mt-3">
          <PredictionLab match={match} />
        </div>
      </details>

      <details
        className="max-w-full min-w-0 rounded-card border border-line bg-raised p-3"
        onToggle={(event) => {
          if (event.currentTarget.open && oddsSource !== "manual") void loadPublicOdds();
        }}
      >
        <summary className="cursor-pointer list-none text-sm font-medium">
          Choose or compare odds sources ·{" "}
          {isDemo ? "Demo estimate" : oddsSource === "betika" ? "Betika" : "SportPesa reference"}
        </summary>
        <div className="mt-3 flex min-w-0 max-w-full flex-col gap-3">
          <p className="text-xs text-muted">
            Choose the line shown above for this match. Public lookups run only when requested. If a
            source has no exact current quote, its prices stay blank; demo lines are clearly
            separate estimates.
          </p>
          <label className="text-sm text-muted">
            Use odds from
            <select
              value={oddsSource}
              onChange={(event) => {
                const next = event.target.value as OddsSource;
                setOddsSource(next);
                if (next === "betika" || next === "sportpesa") void loadPublicOdds();
              }}
              className="mt-1 h-11 w-full rounded-card border border-line bg-surface px-3 text-fg"
            >
              <option value="betika">Betika · public 1X2 quote if exact match found</option>
              <option value="sportpesa">SportPesa · third-party reference snapshot</option>
              <option value="manual">Manual · enter any bookmaker’s 1X2 prices</option>
            </select>
          </label>
          {oddsSource === "manual" ? (
            <fieldset className="rounded-card border border-line bg-surface p-3">
              <legend className="px-1 text-sm text-muted">
                {BOOKS.find((book) => book.id === bookId)?.name ?? "Selected bookmaker"} decimal
                odds
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(["home", "draw", "away"] as const).map((side) => (
                  <label key={side} className="text-xs text-muted">
                    {side === "home" ? "1 · Home" : side === "draw" ? "X · Draw" : "2 · Away"}
                    <input
                      inputMode="decimal"
                      value={manualOddsInput[side]}
                      onChange={(event) =>
                        setManualOddsInput((current) => ({
                          ...current,
                          [side]: event.target.value,
                        }))
                      }
                      placeholder="e.g. 2.10"
                      className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2 text-fg"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Enter all three prices. These are your manually read quotes, not fetched or
                independently verified.
              </p>
            </fieldset>
          ) : null}
          {oddsLoading ? <p className="text-sm text-muted">Checking public odds sources…</p> : null}
          {oddsError ? (
            <p className="text-sm text-muted">
              The check failed. No old or demo price is substituted for the selected source.
            </p>
          ) : null}
          <div className="max-w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-0 table-fixed border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-2 pr-2 font-normal">Source</th>
                  <th className="px-2 py-2 text-center font-normal">1</th>
                  <th className="px-2 py-2 text-center font-normal">X</th>
                  <th className="px-2 py-2 text-center font-normal">2</th>
                  <th className="py-2 pl-2 font-normal">Action</th>
                </tr>
              </thead>
              <tbody>
                <OddsComparisonRow
                  name="Betika public feed"
                  odds={publicOdds?.betika.odds}
                  active={oddsSource === "betika"}
                  onUse={() => {
                    setOddsSource("betika");
                    void loadPublicOdds();
                  }}
                />
                <OddsComparisonRow
                  name="SportPesa comparison reference"
                  odds={publicOdds?.sportpesa.odds}
                  active={oddsSource === "sportpesa"}
                  onUse={() => {
                    setOddsSource("sportpesa");
                    void loadPublicOdds();
                  }}
                />
                <OddsComparisonRow
                  name={`Manual · ${BOOKS.find((book) => book.id === bookId)?.name ?? "bookmaker"}`}
                  odds={manualTriple}
                  active={oddsSource === "manual"}
                  onUse={() => setOddsSource("manual")}
                />
              </tbody>
            </table>
          </div>
          {publicOdds ? (
            <div className="flex flex-col gap-2 text-xs text-muted">
              <p>
                Betika: {publicOdds.betika.detail} {publicOdds.betika.freshness}
              </p>
              {publicOdds.betika.odds ? (
                <a
                  href={publicOdds.betika.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal underline"
                >
                  Verify at Betika
                </a>
              ) : null}
              <p>
                SportPesa: {publicOdds.sportpesa.detail} {publicOdds.sportpesa.freshness}
              </p>
              {publicOdds.sportpesa.sourceUrl ? (
                <a
                  href={publicOdds.sportpesa.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal underline"
                >
                  Verify comparison page
                </a>
              ) : null}
              <p>1xBet: {publicOdds.xbet.detail}</p>
              <a
                href={publicOdds.xbet.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-signal underline"
              >
                Open 1xBet directly
              </a>
              <p>
                Other global odds feeds offer wider book coverage, but the checked service requires
                an API key. It is not configured because you asked for a no-key setup.
              </p>
              <p>
                Checked {new Date(publicOdds.checkedAt).toLocaleTimeString()} local time.
                Third-party comparison odds may be delayed or inaccurate.
              </p>
            </div>
          ) : !oddsLoading ? (
            <p className="text-xs text-muted">
              Betika and SportPesa have not been checked for this fixture yet. Expanding this panel
              or choosing either source starts one exact-fixture check.
            </p>
          ) : null}
        </div>
      </details>

      <div>
        <p className="text-sm text-muted">
          {isDemo
            ? typed
              ? `${quote.book} price you entered manually`
              : `${quote.book} demo estimate, not the live ${quote.book} board`
            : oddsSource === "betika"
              ? `Betika public feed${liveTriple ? " · exact fixture quote" : " · no exact quote available"}`
              : oddsSource === "sportpesa"
                ? `SportPesa comparison snapshot${liveTriple ? " · reference quote" : " · no exact quote available"}`
                : `Manually entered ${BOOKS.find((book) => book.id === bookId)?.name ?? "bookmaker"}${liveTriple ? " · complete 1X2 set" : " · enter all three prices"}`}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <PriceCell
            label="1"
            price={show1x2("home", home.odds, `${match.id}:home:${bookId}`)}
            hot={final.pick === "home"}
            onClick={() => toggleLeg(match.id, "home")}
          />
          <PriceCell
            label="X"
            price={show1x2("draw", draw.odds, `${match.id}:draw:${bookId}`)}
            hot={final.pick === "draw"}
            onClick={() => toggleLeg(match.id, "draw")}
          />
          <PriceCell
            label="2"
            price={show1x2("away", away.odds, `${match.id}:away:${bookId}`)}
            hot={final.pick === "away"}
            onClick={() => toggleLeg(match.id, "away")}
          />
        </div>
      </div>

      {isDemo ? (
        <label className="text-sm text-muted">
          Manually override the {quote.book} demo price for this pick
          <input
            inputMode="decimal"
            placeholder="The number in the app"
            value={typed ?? ""}
            onChange={(event) => {
              const next = Number(event.target.value);
              setQuote(
                match.id,
                market,
                event.target.value.trim() === "" || !Number.isFinite(next) ? null : next,
              );
            }}
            className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
          />
        </label>
      ) : null}

      <p className="text-sm text-fg">
        {!Number.isFinite(shown)
          ? `No ${selectedSourceName} price for this market. Verify at the source or switch sources.`
          : isDemo
            ? match.likely.odds < 1.7
              ? `Likely side is ${formatOdds(match.likely.odds, oddsFormat)} — too short. Not the bet.`
              : `${selectionName(match, market)} · model ${pct(match.model[market])} · ${formatOdds(shown, oddsFormat)}`
            : `${selectionName(match, market)} · selected ${selectedSourceName} ${formatOdds(shown, oddsFormat)} · model comparison is illustrative only`}
      </p>
      {isDemo && match.desk ? (
        <p className="text-sm text-signal">
          Bet {selectionName(match, match.desk.market)} at {formatOdds(match.desk.odds, oddsFormat)}
          . Longer than the short favourite. Illustrative demo only.
        </p>
      ) : !isDemo ? (
        <p className="text-sm text-muted">
          The demo pick is hidden while a public source is selected; no calibrated recommendation is
          available.
        </p>
      ) : (
        <p className="text-sm text-muted">
          No price in the 1.70–3.75 band clears the filter. Pass.
        </p>
      )}
      <p className="text-sm tabular-nums text-muted">
        {Number.isFinite(shown)
          ? `Model fair ${formatOdds(fair, oddsFormat)} · ${isDemo ? `${signedEv(match.model[market] * shown - 1)} · ${riskBand(shown)} demo price` : "not a calibrated edge; verify price directly"}`
          : "Price-derived metrics are unavailable until this source returns a quote."}
        {isDemo && match.best[market].bookId !== bookId
          ? ` · best demo estimate elsewhere ${formatOdds(match.best[market].odds, oddsFormat)} ${match.best[market].book}`
          : ""}
      </p>
      <p className="text-sm text-muted">
        Double chance {dc.label} {pct(dc.probability)} · fair {formatOdds(dc.fair, oddsFormat)}
        {isDemo && stake > 0
          ? ` · illustrative demo stake ${units(stake)}u`
          : isDemo
            ? " · no stake"
            : " · no stake recommendation for public or manual source"}
      </p>
      {injury ? <p className="text-sm text-muted">Absence: {injury}</p> : null}

      <section className="rounded-card border border-line p-3">
        <p className="text-sm font-semibold text-fg">Goals · BTTS · Corners · Cards</p>
        <p className="mt-1 text-sm text-muted">
          About {match.extras.corners.toFixed(1)} corners, more for{" "}
          {match.extras.homeCorners >= match.extras.corners / 2
            ? match.home.short
            : match.away.short}
          . About {match.extras.yellows.toFixed(1)} yellow cards. These are desk estimates, not the
          1xBet board.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {PROP_MARKETS.map((key) => (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {selectionName(match, key)} · {pct(match.model[key])} · fair{" "}
                {formatOdds(fairOdds(match.model[key]), oddsFormat)}
              </span>
              <button
                type="button"
                onClick={() => toggleLeg(match.id, key)}
                className="h-9 shrink-0 rounded-full border border-line px-3"
              >
                {legs.some((leg) => leg.matchId === match.id && leg.market === key)
                  ? "On slip"
                  : "Add"}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">
          Win to nil {match.home.short} {pct(marks.homeNil)}, {match.away.short}{" "}
          {pct(marks.awayNil)}. Clean sheet {pct(marks.homeClean)} / {pct(marks.awayClean)}. First
          goal {match.home.short} {pct(marks.firstHome)}. Draw no bet fair{" "}
          {formatOdds(dnb(match.model.home, match.model.away), oddsFormat)} /{" "}
          {formatOdds(dnb(match.model.away, match.model.home), oddsFormat)}. Corners over 8.5{" "}
          {pct(cornerOver(8))}, over 10.5 {pct(cornerOver(10))}. Yellows over 3.5 {pct(yellowOver)}.
          Both teams and over 2.5 {pct(marks.bothAndOver)}. Top score {match.score}.
        </p>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPreview(match.id)}
          className="h-11 flex-1 rounded-full border border-line text-sm"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setOpen(match.id)}
          className="h-11 flex-1 rounded-full border border-line text-sm"
        >
          Sheet
        </button>
        <button
          type="button"
          onClick={() => toggleLeg(match.id, market)}
          className="h-11 flex-1 rounded-full bg-signal text-sm font-medium text-ink"
        >
          {onSlip ? "On slip" : "Add pick"}
        </button>
      </div>
    </article>
  );
}

const PROP_MARKETS: MarketKey[] = ["over15", "over25", "over35", "btts", "corners95", "red"];

function namedOut(side: { short: string; out: string[] }) {
  const names = side.out.filter((name) => !/no new|no senior|no confirmed/i.test(name));
  if (names.length === 0) return `${side.short} has no listed absence.`;
  return `${side.short} missing ${names.length}: ${names[0]}.`;
}

function PriceCell({ label, price, hot, onClick }: { label: string; price: string; hot: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={"rounded-card px-2 py-2 " + (hot ? "bg-signal text-ink" : "bg-bg text-fg")}>
      <p className="text-xs">{label}</p>
      <p className="font-display text-xl tabular-nums">{price}</p>
    </button>
  );
}

function OddsComparisonRow({
  name,
  odds,
  active,
  onUse,
}: {
  name: string;
  odds?: { home: number; draw: number; away: number };
  active: boolean;
  onUse: () => void;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <th className="py-2 pr-2 text-left text-xs font-normal text-fg">{name}</th>
      {(["home", "draw", "away"] as const).map((side) => (
        <td key={side} className="px-2 py-2 text-center font-mono tabular-nums text-fg">
          {odds ? odds[side].toFixed(2) : "—"}
        </td>
      ))}
      <td className="py-2 pl-2">
        <button
          type="button"
          onClick={onUse}
          disabled={!odds && name !== "demo"}
          className="h-9 rounded-full border border-line px-3 text-xs disabled:opacity-40"
        >
          {active ? "Selected" : odds || name.includes("demo") ? "Use" : "Unavailable"}
        </button>
      </td>
    </tr>
  );
}
