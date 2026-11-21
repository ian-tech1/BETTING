# IAN TECH — Manus and Replit setup

**Predictions are probabilities, not guarantees. No model can promise 100% accuracy or a winning bet.** The app deliberately returns **PASS** when required current team data is missing or stale.

## Accounts and deployment

This build keeps Jackpot selections, manual rows, and bankroll settings in the current browser's local storage. Real app sign-in is supported through the existing auth foundation; Google federation is enabled when the deployment supplies the broker/client configuration. Set `ADMIN_USER_IDS` after the first login to authorize the protected provider settings endpoint. Browser-local selections are not synchronized between devices or browser profiles; when sharing one device, use separate browser profiles/private windows.

## 1. Connect Supabase for durable storage

Create a Postgres database, then add these values in Manus protected secrets or Replit Secrets:

- `APP_POSTGRES_URL`: recommended explicit Postgres connection for this imported app. On Replit, a normal Postgres `DATABASE_URL` is also accepted.

- `SUPABASE_DATABASE_URL`: the Supabase **transaction-pooler** PostgreSQL connection string for serverless runtime.
- `SUPABASE_MIGRATION_URL` (recommended): a direct or session-pooler connection string for schema migrations. If omitted, migrations fall back to the runtime URL.

The app's server-only PostgreSQL adapter prefers `APP_POSTGRES_URL`, then `SUPABASE_DATABASE_URL`, `POSTGRES_URL`, or a Postgres-scheme `DATABASE_URL`. A MySQL/TiDB URL is ignored rather than passed to `pg`. No `service_role` key or browser-side Supabase client is used. Never prefix database credentials with `VITE_`.

`npm run build` builds the app and then runs `npm run db:migrate`. The migration creates the forecast ledger and append-only provider-observation tables. In the Method tab, open **Performance dashboard** and press **Refresh** to see whether Supabase/Postgres is connected and durable. **Sync log** is an explicit write that records eligible future forecasts and settles due results. PGLite is used only in local development. A Vercel deployment without a hosted database still serves the site and JSON endpoint, but the dashboard reports **Database: not configured**, the log is empty, and server-side accuracy learning/persistence is unavailable until `SUPABASE_DATABASE_URL` is added.

## 2. Add optional providers

Add only the keys you have obtained. The application still builds without provider credentials, but live-feature coverage remains missing and predictions are gated to PASS.

- `API_FOOTBALL_KEY` enables verified team/league results, rest and fixture congestion, venue-specific form, standings/motivation, Elo/Dixon–Coles fitting, and on-demand lineup checks. If the league name cannot be uniquely mapped, optionally supply `API_FOOTBALL_LEAGUE_MAP` as a JSON object from exact app league names to API-Football league IDs. Keys remain server-only.
- `ODDS_API_KEY` enables current multi-book 1X2 prices and timestamped observations. Opening/current movement means first/latest **app-observed, provider-timestamped** prices; it is not a guaranteed market open. A pre-kickoff close proxy is reported only when a quote was updated within three hours of kickoff. This is not an official closing line or placed-bet CLV; actual bet CLV also needs the price and time the user took.
- `VENUE_COORDINATES_JSON` supplies verified stadium coordinates by internal fixture ID or exact venue label, for example `{"ars-hul":{"latitude":51.5549,"longitude":-0.1084}}`. Weather is a diagnostic, not a model probability adjustment. The public Open-Meteo endpoint is licensed for non-commercial use; commercial deployment must use a licensed endpoint via `OPEN_METEO_BASE_URL` and comply with Open-Meteo attribution terms. No venue is geocoded by guesswork.
- `GEMINI_API_KEY` enables a bounded analyst nudge; it cannot choose the final result and can be absent when quota is unavailable.
- `FOOTBALL_DATA_KEY` enables finished-result settlement of the prospective log. Results are matched by teams, order, and kickoff time; unmatched results remain pending.

See `.env.example` for the full inventory. Provider plans, limits, league coverage, API availability, and licensing are controlled by those providers and may change.

## 3. Live data and lineups

Every Prediction Lab displays source-by-source readiness and the freshness gate. Use **Refresh live data / lineups** to request fresh information. The API-Football lineup endpoint is fixture-ID based, so the app requires an exact team/competition/date match; ambiguous fixtures are not guessed. The request is made on demand within 90 minutes of a verified kickoff, and a not-yet-announced lineup is kept separate from the frozen forecast. API-Football coverage varies, and lineups may arrive only 20–40 minutes before kickoff, so refresh again closer to the start if needed.

Vercel Hobby Cron is limited to one daily run with substantial timing jitter, so this deployment does **not** promise an unattended T−60 lineup check. Keep the match lab open or press refresh. A frequent unattended check needs a plan/scheduler that supports it and a protected endpoint.

The bundled prediction matches in this archive have kickoffs on 7–8 November 2026. They are now past, so they cannot create new prospective log rows. The expanded OpenFootball calendar is fixture-only and does not supply verified kickoffs, current odds, or the team inputs required for a prediction. Update the supported fixture feed/data before using this app for future games; never treat the old schedule as current.

## 4. Accuracy tracking and automatic recalibration

Forecasts are written once, strictly before kickoff. Model probabilities and the source snapshot are immutable; only a previously empty result can be settled once. The update-protection trigger is enforced in PostgreSQL. Late lineups and later market observations are stored separately and never rewrite the forecast.

The engine/AI-style weights are learned from the last 100 **settled, prospective** forecast records after a minimum history exists. League accuracy reports top-pick rate, Brier score and log loss from pre-kickoff records only. Small samples are labelled early/descriptive; do not interpret them as proof of an edge. Retrospective bundled results are not used to train weights.

The dashboard's movement/close proxy requires stored pre-kickoff observations. If the app is not open and no authorized scheduler collects quotes, there may be no history to compare. The current Odds API endpoint does not backfill a verified open/close history.

## 5. Read-only JSON endpoint

After deployment, `GET /api/predictions` returns JSON with `log`, `picks`, `accuracy`, `marketBenchmarks`, and a safe database status (no credentials). Use `?limit=100` to limit returned log/pick rows; the maximum is 1,000. Accuracy is calculated from the full eligible log, not the response limit. The endpoint is read-only and contains no personal account data.

## 6. Verify and deploy

1. Add environment variables to the Vercel Production (and Preview, if desired) environment.
2. Deploy using the repository's build command `npm run build`; keep the `npm run db:migrate` step enabled.
3. Open Method → Performance dashboard → **Refresh** and confirm `Supabase: connected · durable`.
4. Press **Sync log** only when eligible future fixtures are present, then verify returned metrics and source snapshots. Confirm `GET /api/predictions` returns JSON.
5. Run `npm test` and `npm run typecheck` on the source archive before publishing.

## Reference docs

- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres) and [serverless driver guidance](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)
- [API-Football v3](https://www.api-football.com/documentation-v3)
- [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/)
- [Open-Meteo forecast API](https://open-meteo.com/en/docs), [pricing/licensing](https://open-meteo.com/en/pricing), and [license](https://open-meteo.com/en/licence)
- [Vercel Cron Jobs](https://vercel.com/docs/schedules/cron-jobs) and [usage limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing)
- [Dixon–Coles paper record](https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065)
