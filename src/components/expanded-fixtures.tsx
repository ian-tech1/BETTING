import { Fragment, useCallback, useEffect, useState } from "react";
import { LEAGUE_CODES } from "@/data/weekend";
import { fixtureAsPricedMatch, getExpandedFixtures, type ExpandedFixtureFeed } from "@/lib/global-fixtures";
import { useDesk } from "@/lib/desk-store";
import { MatchCard } from "@/components/match-card";
import { syncTracker } from "@/lib/tracker-fn";
const PAGE_SIZE = 2000;

export function ExpandedFixtures({ window = "today-tomorrow" }: { window?: "today-tomorrow" | "future" }) {
  const league = useDesk((state) => state.league);
  const sortKey = useDesk((state) => state.sortKey);
  const setLeague = useDesk((state) => state.setLeague);
  const query = useDesk((state) => state.query);
  const [feed, setFeed] = useState<ExpandedFixtureFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selectedDate, setSelectedDate] = useState("ALL");
  const [selectedMonth, setSelectedMonth] = useState("ALL");

  const active = league === "ALL" ? "ALL" : league;
  const selectedCompetition = feed?.competitions.find((item) => item.code === active);
  const dateOptions = feed
    ? Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${feed.today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + index);
        const iso = date.toISOString().slice(0, 10);
        return {
          iso,
          label: index === 0 ? "Today" : index === 1 ? "Tomorrow" : date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" }),
        };
      })
    : [];
  const explicitDateFilter = selectedDate !== "ALL" || selectedMonth !== "ALL";
  const rows = (feed?.fixtures ?? [])
    .filter((fixture) => {
      if (!explicitDateFilter && feed && window === "today-tomorrow" && fixture.date !== feed.today && fixture.date !== feed.tomorrow) return false;
      if (!explicitDateFilter && feed && window === "future" && fixture.date <= feed.tomorrow) return false;
      if (active !== "ALL" && fixture.code !== active) return false;
      if (selectedDate !== "ALL" && fixture.date !== selectedDate) return false;
      if (selectedMonth !== "ALL" && !fixture.date.startsWith(selectedMonth)) return false;
      if (!query.trim()) return true;
      const haystack =
        `${fixture.home} ${fixture.away} ${fixture.competition} ${fixture.code}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sortKey === "competition") {
        const indexA = LEAGUE_CODES.indexOf(a.code as (typeof LEAGUE_CODES)[number]);
        const indexB = LEAGUE_CODES.indexOf(b.code as (typeof LEAGUE_CODES)[number]);
        if (indexA !== indexB) return indexA - indexB;
      }
      return (
        a.date.localeCompare(b.date) ||
        a.competition.localeCompare(b.competition) ||
        a.home.localeCompare(b.home)
      );
    });

  const loadFixtures = useCallback(async () => {
    if (loading || feed) return;
    setLoading(true);
    setError(false);
    try {
      const nextFeed = await getExpandedFixtures();
      setFeed(nextFeed);
      // Recording is additive and server-computed; it freezes only future
      // fixtures, allowing completed games to settle against the same pick.
      void syncTracker().catch(() => undefined);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [feed, loading]);

  useEffect(() => {
    if (feed || loading) return;
    void loadFixtures();
  }, [feed, loading, loadFixtures]);

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="border-b border-line bg-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-signal">
              {window === "today-tomorrow" ? "Ready games · today and tomorrow" : "Upcoming games · after tomorrow"}
            </p>
            <h2 className="mt-1 font-display text-2xl">{window === "today-tomorrow" ? "Today and tomorrow by competition" : "Future games by competition"}</h2>
            <p className="mt-2 text-sm text-muted">{window === "today-tomorrow" ? "Only games scheduled today or tomorrow are shown." : "Only games after tomorrow are shown."} Open a game for its prediction details.</p>
          </div>
          {feed ? (
            <span className="rounded-full border border-line bg-surface px-3 py-2 text-sm tabular-nums text-fg">
              {feed.fixtures.length} games
            </span>
          ) : null}
        </div>

        {!feed ? (
          <button
            type="button"
            onClick={() => void loadFixtures()}
            disabled={loading}
            className="mt-4 h-11 rounded-full bg-signal px-5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {loading ? "Loading games…" : "Refresh games"}
          </button>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-muted">
              {rows.length} games available in this window across{" "}
              {feed.competitions.filter((item) => item.count > 0).length} supported competitions,{" "}
              {feed.from}–{feed.through}. {feed.liveProvider ? "Live provider rows are merged here first, with source labels and kickoff times." : "Configured live providers returned no rows; the public schedule fallback is shown."}
            </p>
            <div className="flex flex-wrap items-center gap-2" aria-label="Game date selector">
              <span className="text-xs font-medium text-fg">Browse games:</span>
              <button type="button" onClick={() => { setSelectedDate("ALL"); setSelectedMonth("ALL"); setVisible(PAGE_SIZE); }} className="h-9 rounded-full border border-line px-3 text-xs">{window === "today-tomorrow" ? "Today + tomorrow" : "All future"}</button>
              {dateOptions.map((option) => (
                <button key={option.iso} type="button" aria-pressed={selectedDate === option.iso} onClick={() => { setSelectedDate(option.iso); setSelectedMonth("ALL"); setVisible(PAGE_SIZE); }} className={`h-9 shrink-0 rounded-full border px-3 text-xs ${selectedDate === option.iso ? "border-signal bg-signal text-ink" : "border-line"}`}>
                  {option.label} <span className="ml-1 opacity-70">{option.iso.slice(5)}</span>
                </button>
              ))}
              <label className="flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs text-muted">Date <input type="date" value={selectedDate === "ALL" ? "" : selectedDate} min={feed.from} max={feed.through} onChange={(event) => { setSelectedDate(event.target.value || "ALL"); setSelectedMonth("ALL"); setVisible(PAGE_SIZE); }} className="bg-transparent text-fg outline-none" /></label>
              <label className="flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs text-muted">Month <input type="month" value={selectedMonth === "ALL" ? "" : selectedMonth} onChange={(event) => { setSelectedMonth(event.target.value || "ALL"); setSelectedDate("ALL"); setVisible(PAGE_SIZE); }} className="bg-transparent text-fg outline-none" /></label>
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              aria-label="Game competitions"
            >
              <button
                type="button"
                aria-pressed={active === "ALL"}
                onClick={() => {
                  setLeague("ALL");
                  setVisible(PAGE_SIZE);
                }}
                className={
                  "h-10 shrink-0 rounded-full px-4 text-sm font-medium " +
                  (active === "ALL" ? "bg-signal text-ink" : "border border-line text-fg")
                }
              >
                All competitions · {feed.fixtures.length}
              </button>
              {feed.competitions
                .filter((item) => item.count > 0)
                .map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    aria-pressed={active === item.code}
                    onClick={() => {
                      setLeague(item.code as typeof league);
                      setVisible(PAGE_SIZE);
                    }}
                    className={
                      "h-10 shrink-0 rounded-full px-4 text-sm font-medium " +
                      (active === item.code ? "bg-signal text-ink" : "border border-line text-fg")
                    }
                  >
                    {item.label} · {item.count}
                  </button>
                ))}
            </div>
          </div>
        )}
        {error ? (
          <p role="status" className="mt-3 text-sm text-muted">
            The live schedule source could not be reached. No live rows are being invented.
          </p>
        ) : null}
        {feed?.unavailable.length && rows.length === 0 ? (
          <p role="status" className="mt-3 text-xs text-muted">
            Live provider feeds are unavailable. No games were returned for this filter.
          </p>
        ) : null}
      </div>

      {feed ? (
        <div className="p-4 sm:p-5">
          {rows.length === 0 ? (
            <p className="rounded-card border border-line p-4 text-sm text-muted">
              {selectedCompetition
                ? `No ${selectedCompetition.label} games match this filter.`
                : "No games match this filter. Try All, Today, or Tomorrow."}
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {rows.slice(0, visible).map((fixture, index, visibleRows) => (
                  <Fragment key={fixture.id}>
                    {index === 0 || visibleRows[index - 1].date !== fixture.date ? (
                      <h3 className="font-display text-xl text-fg sm:col-span-2">
                        {fixture.date === feed.today ? "Today" : fixture.date === feed.tomorrow ? "Tomorrow" : new Date(`${fixture.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
                      </h3>
                    ) : null}
                    {index === 0 || visibleRows[index - 1].date !== fixture.date || visibleRows[index - 1].competition !== fixture.competition ? (
                      <h4 className="-mb-1 mt-1 text-sm font-semibold uppercase tracking-wide text-signal sm:col-span-2">
                        {fixture.competition} · {visibleRows.filter((row) => row.date === fixture.date && row.competition === fixture.competition).length} games
                      </h4>
                    ) : null}
                    <MatchCard match={fixtureAsPricedMatch(fixture)} />
                  </Fragment>
                ))}
              </div>
              {rows.length > visible ? (
                <button
                  type="button"
                  onClick={() => setVisible((current) => current + PAGE_SIZE)}
                  className="mt-4 h-11 w-full rounded-full border border-line text-sm font-medium text-fg"
                >
                  Show {Math.min(PAGE_SIZE, rows.length - visible)} more · {rows.length - visible}{" "}
                  remaining
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
