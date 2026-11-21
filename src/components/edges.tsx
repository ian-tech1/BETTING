import { oddsText, pct, signedEv, signedPts, units } from "@/lib/format";
import {
  MATCHES,
  rankedEdges,
  selectionName,
  shortMarket,
  suggestedStake,
  type FlatEdge,
  type PricedMatch,
} from "@/lib/price";
import { useDesk } from "@/lib/desk-store";

function bestPerMatch(rows: FlatEdge[]): FlatEdge[] {
  const seen = new Set<string>();
  const out: FlatEdge[] = [];
  for (const row of rows) {
    if (seen.has(row.match.id)) continue;
    seen.add(row.match.id);
    out.push(row);
  }
  return out;
}

export function Edges() {
  const bankroll = useDesk((s) => s.bankroll);
  const setOpen = useDesk((s) => s.setOpen);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const legs = useDesk((s) => s.legs);
  const favorites = MATCHES.filter((match) => match.likely.model >= 0.45).sort(
    (a, b) => b.likely.model - a.likely.model,
  );
  const prices = bestPerMatch(rankedEdges());

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-4xl text-fg">Two different lists</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Favourites are who the model thinks is most likely. Plus-EV prices are where a book
          looks generous. A likely winner can be a bad bet, and a plus-EV bet can lose. Nothing
          here is a correct bet.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl">Most likely results</h2>
        <p className="text-sm text-muted">Only sides the model puts at 45% or better.</p>
        <div className="flex flex-col gap-3">
          {favorites.map((match) => (
            <FavoriteRow key={match.id} match={match} onOpen={() => setOpen(match.id)} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl">Prices that look wrong</h2>
        <p className="max-w-2xl text-sm text-pretty text-muted">
          One selection per match. Quarter-Kelly stake, capped at 4% of the {units(bankroll)} unit
          bank in the header. Change the bank before you read the stake.
        </p>
        {prices.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-muted">
            No price clears the filter this weekend.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {prices.map((row) => {
              const onSlip = legs.some(
                (leg) => leg.matchId === row.match.id && leg.market === row.market,
              );
              const stake = suggestedStake(row, bankroll);
              return (
                <article
                  key={`${row.match.id}-${row.market}`}
                  className="grid gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-muted">
                      {row.match.code} · {row.match.dateLabel} · {row.match.time} UK
                    </p>
                    <h3 className="mt-1 font-sans text-lg font-medium text-fg">
                      {row.match.home.short} v {row.match.away.short}
                    </h3>
                    <p className="mt-1 text-fg">{selectionName(row.match, row.market)}</p>
                    <p className="mt-1 text-sm text-muted">
                      Model {pct(row.model)} · market {pct(row.consensus)} · {row.confidence}{" "}
                      confidence · most likely result is {shortMarket(row.match, row.match.likely.market)}{" "}
                      {pct(row.match.likely.model)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 md:justify-end">
                    <div className="min-w-28">
                      <p className="font-display text-3xl tabular-nums text-signal">{oddsText(row.odds)}</p>
                      <p className="text-sm text-muted">{row.book}</p>
                      <p className="text-sm tabular-nums text-fg">
                        {signedPts(row.edge)} · {signedEv(row.ev)}
                      </p>
                      <p className="text-sm tabular-nums text-muted">{units(stake)} units</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setOpen(row.match.id)}
                        className="h-11 rounded-full border border-line px-4 text-sm text-fg"
                      >
                        Sheet
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleLeg(row.match.id, row.market)}
                        className="h-11 rounded-full bg-signal px-4 text-sm font-medium text-ink"
                      >
                        {onSlip ? "Remove" : "Add"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function FavoriteRow({ match, onOpen }: { match: PricedMatch; onOpen: () => void }) {
  const short = match.likely.ev <= -0.03;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-card border border-line bg-surface p-4 text-left"
    >
      <p className="font-display text-3xl tabular-nums">{pct(match.likely.model)}</p>
      <div className="min-w-0">
        <p className="truncate font-medium">{selectionName(match, match.likely.market)}</p>
        <p className="truncate text-sm text-muted">
          {match.home.short} v {match.away.short} · {match.dateLabel} {match.time}
        </p>
      </div>
      <p className={"text-right text-sm " + (short ? "text-muted" : "text-signal")}>
        {oddsText(match.likely.odds)}
        <span className="block text-muted">{short ? "Too short" : match.likely.book}</span>
      </p>
    </button>
  );
}
