import { BOOKS } from "@/lib/price";
import { BacktestPanel } from "@/components/backtest-panel";
import { PerformanceDashboard } from "@/components/performance-dashboard";

const STEPS = [
  {
    title: "Goals, not a guess",
    body: "Each side's last five results are weighted so the newest games count more than the start of the run. Named players who are out cut that side's attack and weaken their defence. Dixon-Coles still allows more 0-0 and 1-1. The prices next to a book name are desk estimates, not that book's live board. Type the decimal you see at your bookmaker into the slip if you want the return to match the price you see.",
  },
  {
    title: "The grid becomes markets",
    body: "Sum the cells and you get home, draw, away, both teams to score, and over or under 2.5. The most likely scoreline is just the single busiest cell. It is usually 1–1 in an even match. That does not mean the model “predicts 1–1” as a bet.",
  },
  {
    title: "Board prices are estimates",
    body: "The named-book rows on the main board are seeded demo estimates, not current quotes from Pinnacle, Betfair, Betika, SportPesa, 1xBet, or any other operator. Their margin and edge calculations do not measure a real market advantage. Enter the price you actually see or verify a separate public reference; never stake from a simulated quote.",
  },
  {
    title: "In-play is the xG that is left",
    body: "A live match keeps the pre-match expected goals, spends them as the minute runs, and adds the goals already on the board. What is left is another Poisson. That is the in-play home, draw and away, and the chance of the next goal. The tape is a desk clock, not a television feed.",
  },
  {
    title: "The slip is yours to place",
    body: "Pick the site you will actually use. The slip reprices every leg there, shows the same slip at every other site, and copies the lines. IAN TECH cannot log in, cannot send a booking code, and cannot place the bet. A code that loads inside 1xBet is printed by 1xBet, not here.",
  },
  {
    title: "Stake small, or not at all",
    body: "Expected value is model probability times the best decimal price, minus one. The suggested stake is a quarter of the Kelly fraction, and never more than 4% of the bank you type in. If nothing clears a 2-point edge, the match is a pass.",
  },
];

export function Method() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="font-display text-4xl">How the desk works</h1>
        <p className="mt-2 text-pretty text-muted">
          IAN TECH reconciles the local statistical engine, its formula-model lab, and any available
          verified provider signals into one final result. The local models share inputs and are not
          independent votes. API-backed Elo, venue form, rest, standings, odds, lineups, or weather
          appear only when a provider response can be matched and timestamped. Required team-data
          gaps cause a PASS rather than an invented live forecast. These systems still cannot
          guarantee a correct result or 100% accuracy.
        </p>
      </div>
      <section className="rounded-card border border-line bg-signal p-4 text-ink">
        <h2 className="font-display text-2xl">Quick guide to using IAN TECH</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>Open Ready or Upcoming and choose the bookmaker and market you want to review.</li>
          <li>
            Open a match’s prediction lab to see the 25 local models, 17 diagnostics, sample coverage,
            model spread, stress check, source status, freshness gate, and risk warnings. Refresh
            live data/lineups when close to kick-off.
          </li>
          <li>
            In Jackpot, read the team order carefully: 1 is the home team shown first, X is draw,
            and 2 is the away team shown second. Select only one result per match.
          </li>
          <li>
            A red flag marks a 10-point-or-greater gap between a no-vig price probability and the
            matching local model probability. It is a caution, not proof that a bet will lose.
          </li>
          <li>
            If a public bookmaker quote is missing, add a match and type the exact three prices from
            that bookmaker’s app. Manual prices are user-entered and are not independently verified.
          </li>
          <li>
            Selections, manual rows, and settings are saved only in this browser profile. They do not
            sync with other devices or profiles; use a separate browser profile/private window if
            sharing the same device.
          </li>
        </ol>
        <p className="mt-3 text-sm">
          Always verify the fixture, kickoff, team order, and price in the bookmaker app. IAN TECH
          does not place bets, and no result is certain.
        </p>
      </section>
      <ol className="flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-card border border-line bg-surface p-4">
            <p className="text-sm text-signal">0{index + 1}</p>
            <h2 className="mt-1 font-display text-2xl">{step.title}</h2>
            <p className="mt-2 text-pretty text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <section className="rounded-card border border-line bg-raised p-4">
        <h2 className="font-display text-2xl">Match order and bookmaker alignment</h2>
        <p className="mt-2 text-pretty text-sm text-muted">
          Select a league, then choose Sort → Competition → kickoff to group matches by competition
          and order them by the listed start time. The same local schedule order is used for every
          bookmaker selection, and the expanded schedule follows the same rule. This is not a live
          mirror of the order inside 1xBet or another operator; a true per-book mirror requires an
          authorized, current fixture feed from that operator. All live quotes and missing fixture
          matches remain subject to the source limits described below.
        </p>
      </section>
      <section className="rounded-card border border-line bg-raised p-4">
        <h2 className="font-display text-2xl">Server data, Supabase, and calibration</h2>
        <p className="mt-2 text-pretty text-sm text-muted">
          Sign-in and Google federation can be enabled with the app’s real auth configuration, while
          admin role IDs unlock the protected provider settings endpoint. For durable persistence,
          configure APP_POSTGRES_URL (or a Postgres-compatible DATABASE_URL on Replit) and run the
          included migrations; the Method tab’s Performance dashboard checks connection and
          durability. Manus-managed DATABASE_URL values are MySQL-compatible and are intentionally
          not passed to this imported Postgres adapter. Without a hosted Postgres database, preview
          storage is ephemeral. Optional API_FOOTBALL_KEY supplies recent results, rest/fatigue,
          venue-split form, standings/motivation, longer-history Elo, fitted time-decayed Dixon–Coles,
          and fixture-matched lineups. ODDS_API_KEY collects current 1X2 quotes and app-observed
          movement. Verified VENUE_COORDINATES_JSON coordinates enable Open-Meteo weather diagnostics.
          MANUS_API_KEY enables a bounded Manus AI review, and FOOTBALL_DATA_KEY settles logged
          results. All credentials stay server-side; see DEPLOYMENT.md, SETUP.md, and .env.example
          for configuration.
        </p>
        <p className="mt-2 text-pretty text-sm text-muted">
          Model weights learn from up to the last 100 prospective, settled log entries; league metrics
          are shown with sample-size warnings. Late lineup and market observations are stored
          separately so frozen forecasts remain unchanged. The dashboard’s close-line metric is only
          a timestamp-qualified proxy, not official closing odds or a user's actual bet CLV.
          Open-Meteo’s public endpoint is non-commercial; commercial use requires a licensed endpoint.
        </p>
      </section>
      <section className="rounded-card border border-line bg-raised p-4">
        <h2 className="font-display text-2xl">Expanded fixture schedule</h2>
        <p className="mt-2 text-pretty text-sm text-muted">
          The expanded schedule loads on request from OpenFootball’s public-domain fixture JSON for
          eight competitions: England’s Premier League and Championship, plus Germany, Spain,
          France, Italy, the Netherlands, and Portugal’s top divisions. It adds calendar-date rows
          for a rolling 30-day window and links each row to its source. These are not a complete
          1xBet Global event feed. Source rows do not include reliable kick-off times, current
          bookmaker odds, or the team statistics used by the prediction models, so they are shown as
          fixture-only and receive no generated pick. Dates and postponements must be verified. The
          OpenFootball repository says its latest-season files are auto-published daily, but its
          upstream match data is not guaranteed to update daily.
        </p>
        <a
          href="https://github.com/openfootball/football.json"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-signal underline"
        >
          OpenFootball source and license
        </a>
      </section>
      <PerformanceDashboard />
      <BacktestPanel />
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-2xl">Books on the board</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {BOOKS.map((book) => (
            <li key={book.id} className="rounded-full border border-line px-3 py-2 text-sm">
              {book.name}
              {book.sharp ? <span className="text-muted"> · sharp</span> : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-pretty text-sm text-muted">
          These are seeded demonstration prices reconstructed around the model. They are not live
          quotes and are not scraped from the named bookmakers. As a result, the calculated edge,
          value filter, expected value, and stake display are illustrative only—not real market
          measurements or betting advice.
        </p>
      </section>
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-2xl">Public odds checks</h2>
        <p className="mt-2 text-pretty text-sm text-muted">
          The Jackpot tab accepts Betika prices only when both teams, their home/away order, a valid
          future kickoff, and all three decimal prices match. It checks SportPesa’s official public
          jackpot feed without a login or API key; this runtime received HTTP 403 from that feed, so
          no SportPesa prices are shown here unless the feed becomes accessible or you enter prices
          from the app manually. SportPesa home/away is never guessed from competitor row order. The
          official SportPesa homepage also presented a CAPTCHA, so neither restriction is bypassed.
          When a match card’s lab opens, it can check a public Kenya comparison page for an exact
          SportPesa row. That third-party site warns that prices may be delayed or inaccurate, so
          the result is only a reference snapshot. No automated 1xBet quote is shown: its public
          page is not reliably readable here and available bookmaker-specific aggregator terms
          prohibit automated reuse without permission. In the match-card odds panel, compare
          available Betika and SportPesa reference prices against the demo estimate. You can also
          enter all three prices manually for another bookmaker, including on Jackpot. Missing
          public quotes stay blank; they are never replaced by demo prices when a public source is
          selected.
        </p>
      </section>
      <section className="rounded-card border border-line bg-raised p-4">
        <h2 className="font-display text-2xl">What this will not do</h2>
        <p className="mt-2 text-pretty text-muted">
          No model produces correct bets. A 68% side loses about one time in three. A plus-EV price
          is a long-run argument about the number, and a short weekend is not the long run. xG, form
          and absences on this card are a compiled scouting snapshot, not a live injury wire. IAN
          TECH cannot log in to a bookmaker and cannot place a bet for you.
        </p>
        <p className="mt-3 text-pretty text-sm text-muted">
          Only stake money you can lose. If betting stops being a choice, stop. Local gambling-help
          services exist for that moment. 18+.
        </p>
      </section>
    </div>
  );
}
