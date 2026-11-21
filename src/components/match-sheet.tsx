import { useEffect, useState, type ReactNode } from "react";
import type { Side } from "@/data/weekend";
import { X } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FormPills } from "@/components/bits";
import { argmax, predictionFeeds, readLine } from "@/lib/engines";
import { halfTimeLean, topScorelines } from "@/lib/inplay";
import { oddsText, pct, signedEv, signedPts, units } from "@/lib/format";
import {
  MARKET_KEYS,
  RECENT,
  actualSide,
  findMatch,
  marketLabel,
  quoteAt,
  selectionName,
  shortMarket,
  suggestedStake,
  type MarketKey,
  type PricedMatch,
} from "@/lib/price";
import { useDesk } from "@/lib/desk-store";
import { useConsensus } from "@/lib/use-consensus";
import { ConsensusBadge } from "@/components/consensus-badge";

const EMPTY_SIDE: Side = { name: "", short: "", pos: 10, form: [], xgFor: 1.3, xgAgainst: 1.3, gf: 0, ga: 0, played: 0, out: [] };

export function MatchSheet({ id }: { id: string }) {
  const match = findMatch(id);
  const setOpen = useDesk((s) => s.setOpen);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const legs = useDesk((s) => s.legs);
  const bankroll = useDesk((s) => s.bankroll);
  const bookId = useDesk((s) => s.bookId);
  const [chartOn, setChartOn] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => setChartOn(true));
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      cancelAnimationFrame(frame);
    };
  }, [setOpen]);

  const tip = useConsensus(id, match?.home ?? EMPTY_SIDE, match?.away ?? EMPTY_SIDE, { league: match?.league });
  if (!match) return null;
  const settled = RECENT.find((row) => row.id === match.id);
  const lines = topScorelines(match.lambdaHome, match.lambdaAway, 3);
  const ht = halfTimeLean(match.lambdaHome, match.lambdaAway);
  const yours = quoteAt(match, bookId, match.likely.market);
  const pack = predictionFeeds(match.home, match.away);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close sheet" className="absolute inset-0 bg-ink/70" onClick={() => setOpen(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-card border border-line bg-bg p-4 sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {match.league} · {match.dateLabel} · {match.time} UK
            </p>
            <h2 id="sheet-title" className="font-display text-3xl">
              {match.home.name} v {match.away.name}
            </h2>
            <p className="mt-2 text-sm text-muted">{match.venue}</p>
            {settled ? (
              <p className="mt-3 text-fg">
                Full time {settled.homeGoals}–{settled.awayGoals}. Model had called {shortMarket(match, match.likely.market)}.{" "}
                {actualSide(settled) === match.likely.market ? "That call landed." : "That call missed."}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <SideBlock match={match} side="home" />
            <SideBlock match={match} side="away" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Home xG" value={match.lambdaHome.toFixed(2)} />
            <Stat label="Modal score" value={match.score} />
            <Stat label="Away xG" value={match.lambdaAway.toFixed(2)} />
          </div>

          <ConsensusBadge c={tip} home={match.home.short} away={match.away.short} signalsUsed={tip.signalsUsed} />
          <p className="text-pretty text-muted">{match.read}</p>
          <section>
            <p className="text-sm text-signal">{readLine(match.home.short, match.away.short, pack)}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {pack.extras.map((feed) => {
                const side = argmax(feed);
                const label = side === "home" ? match.home.short : side === "away" ? match.away.short : "Draw";
                return (
                  <li key={feed.id} className="rounded-full border border-line px-3 py-1 text-xs" title={feed.note}>
                    {feed.name} · {label}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label="Half-time lean" value={`${pct(Math.max(ht.home, ht.draw, ht.away))}`} />
            <Stat label={`${match.home.short} −0.5`} value={oddsText(quoteAt(match, bookId, "home").odds)} />
            <Stat label="Your price" value={`${oddsText(yours.odds)} ${yours.book}`} />
          </section>
          <p className="text-sm text-muted">
            Top scores {lines.map((line) => `${line.score} ${pct(line.p)}`).join(" · ")}. Asian{" "}
            {match.home.short} −0.5 is the same bet as the home win. Half-time uses 45% of the full-match xG.
          </p>

          <section className="grid gap-3 sm:grid-cols-2">
            <Call
              kicker="Most likely result"
              title={selectionName(match, match.likely.market)}
              detail={`${pct(match.likely.model)} · best ${oddsText(match.likely.odds)} ${match.likely.book}`}
              note={
                match.likely.ev >= 0.02
                  ? "The likely side still has a price edge."
                  : match.likely.ev <= -0.03
                    ? "Likely, and the price is shorter than the model. That is a pass if you only bet value."
                    : "Likely, and the price is about fair."
              }
            />
            <Call
              kicker="Plus-EV price"
              title={match.desk ? selectionName(match, match.desk.market) : "Pass"}
              detail={
                match.desk
                  ? `${oddsText(match.desk.odds)} ${match.desk.book} · ${signedPts(match.desk.edge)} · ${signedEv(match.desk.ev)}`
                  : "No market clears the desk filter."
              }
              note={
                match.desk
                  ? `Suggested ${units(suggestedStake(match.desk, bankroll))} units on a ${units(bankroll)} bank.`
                  : "Do not force a selection."
              }
              action={
                match.desk ? (
                  <button
                    type="button"
                    onClick={() => toggleLeg(match.id, match.desk!.market)}
                    className="mt-3 h-11 rounded-full bg-signal px-4 text-sm font-medium text-ink"
                  >
                    {legs.some((leg) => leg.matchId === match.id && leg.market === match.desk?.market)
                      ? "Remove from slip"
                      : "Add plus-EV to slip"}
                  </button>
                ) : null
              }
            />
          </section>

          <section>
            <h3 className="font-display text-2xl">Prices</h3>
            <p className="mt-1 text-sm text-muted">Signal numbers are the best price in that column. Your site is marked.</p>
            <div className="mt-3 overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm tabular-nums">
                <thead className="bg-raised text-muted">
                  <tr>
                    <th className="px-3 py-3 font-medium">Book</th>
                    {MARKET_KEYS.map((key) => (
                      <th key={key} className="px-3 py-3 font-medium">
                        {marketLabel(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {match.books.map((book) => (
                    <tr key={book.id} className={"border-t border-line " + (book.id === bookId ? "bg-raised" : "")}>
                      <th className="px-3 py-3 text-left font-medium text-fg">
                        {book.name}
                        {book.id === bookId ? <span className="block font-normal text-signal">Your site</span> : null}
                        {book.sharp && book.id !== bookId ? <span className="block font-normal text-muted">Sharp</span> : null}
                      </th>
                      {MARKET_KEYS.map((key) => {
                        const best = match.best[key].bookId === book.id;
                        return (
                          <td key={key} className={"px-3 py-3 " + (best ? "font-medium text-signal" : "text-fg")}>
                            {oddsText(book.odds[key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="font-display text-2xl">Total goals</h3>
            <div className="mt-3 h-48 rounded-card border border-line bg-surface p-3">
              {chartOn ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={match.goalDist}>
                    <XAxis dataKey="goals" stroke="#8a8478" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ fill: "rgba(214,242,92,0.08)" }}
                      contentStyle={{ background: "#17160f", border: "1px solid #2c2a22", borderRadius: 12 }}
                    />
                    <Bar dataKey="pct" fill="#d6f25c" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="font-display text-2xl">Add a market</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {MARKET_KEYS.map((key) => (
                <MarketRow key={key} match={match} market={key} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function SideBlock({ match, side }: { match: PricedMatch; side: "home" | "away" }) {
  const team = match[side];
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="font-medium">{team.name}</p>
      <p className="text-sm text-muted">
        {ordinal(team.pos)} · {team.xgFor.toFixed(2)} xG for, {team.xgAgainst.toFixed(2)} against
      </p>
      <div className="mt-2">
        <FormPills form={team.form} />
      </div>
      <p className="mt-2 text-sm text-muted">{team.out.length ? team.out.join(", ") : "No listed absence"}</p>
    </div>
  );
}

function MarketRow({ match, market }: { match: PricedMatch; market: MarketKey }) {
  const edge = match.edges.find((item) => item.market === market);
  const legs = useDesk((s) => s.legs);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const bookId = useDesk((s) => s.bookId);
  if (!edge) return null;
  const yours = quoteAt(match, bookId, market);
  const on = legs.some((leg) => leg.matchId === match.id && leg.market === market);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
      <div>
        <p className="font-medium">{selectionName(match, market)}</p>
        <p className="text-sm tabular-nums text-muted">
          Model {pct(edge.model)} · yours {oddsText(yours.odds)} {yours.book} · best {oddsText(edge.odds)} {edge.book}
        </p>
      </div>
      <button
        type="button"
        onClick={() => toggleLeg(match.id, market)}
        className="h-11 rounded-full bg-signal px-4 text-sm font-medium text-ink"
      >
        {on ? "On slip" : "Add"}
      </button>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function Call({
  kicker,
  title,
  detail,
  note,
  action,
}: {
  kicker: string;
  title: string;
  detail: string;
  note: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-signal">{kicker}</p>
      <h3 className="mt-1 font-display text-2xl">{title}</h3>
      <p className="mt-2 text-sm tabular-nums text-fg">{detail}</p>
      <p className="mt-2 text-sm text-pretty text-muted">{note}</p>
      {action}
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
