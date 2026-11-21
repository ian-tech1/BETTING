# Integration research notes

Research captured 11 November 2026 for the IAN TECH v5 update. These notes summarize provider contracts relevant to the implementation; they do not imply any key, account, feed coverage, database connection, or historical records are configured.

## Supabase Postgres on Vercel

Supabase documents the shared pooler in transaction mode for serverless/edge functions, and recommends keeping the application-side pool small, disabling prepared statements where the transaction pooler does not support them, and requiring SSL. Its serverless guide gives a Vercel example using the transaction-pooler connection string. Migrations/backup and other session-dependent administration are separately directed toward direct connections. For this app, a server-only Postgres URL can be used with the existing `pg` adapter; no browser-side service-role key is needed. The actual Supabase connection string/password must be configured by the owner in Vercel secrets.

Sources: [Supabase Postgres connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres); [Supabase serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers).

## API-Football

API-Football v3 uses the `x-apisports-key` request header. Its fixtures endpoint supports filters including team, season, date range, status and fixture ID. Standings are requested by league and season and the response includes rank, points, form, home/away summaries, and an update timestamp. The lineups endpoint is keyed by fixture; the documentation says lineups are typically available about 20–40 minutes before kickoff when the competition supports coverage, may arrive after the match for other competitions, and the endpoint updates every 15 minutes. Thus a check at T−60 may be too early and must report “not announced” separately from “unavailable.”

Source: [API-Football v3 documentation](https://www.api-football.com/documentation-v3).

## Open-Meteo

The forecast endpoint requires WGS84 latitude/longitude and can return requested hourly variables such as 2 m temperature, precipitation, 10 m wind speed, and weather code. The API supports time zones and ISO/Unix timestamps; its docs warn that DST changes within the requested range are ignored for ISO-local timestamp generation, so kickoff-hour matching should use UTC/Unix time and the stadium timezone explicitly. The public free API is for non-commercial use and does not provide an uptime guarantee; the commercial subscription provides a commercial-use license and dedicated API endpoint. Weather data attribution is required under CC BY 4.0. The geocoding endpoint searches place names but does not certify an arbitrary stadium name as a stadium coordinate, so ambiguous venue strings must not be silently geocoded into match weather.

Sources: [Forecast API](https://open-meteo.com/en/docs); [Geocoding API](https://open-meteo.com/en/docs/geocoding-api); [Pricing and commercial license](https://open-meteo.com/en/pricing); [License](https://open-meteo.com/en/licence).

## Vercel scheduled checks

Vercel's Cron Jobs documentation states Hobby allows at most one run per day with hour-level timing jitter (up to ±59 minutes); Pro and Enterprise support once-per-minute scheduling. Therefore an unattended T−60/T−30 lineup check cannot be promised on a Hobby plan. The app can safely offer an on-demand or while-open check; an unattended frequent schedule requires a suitable plan or external scheduler and a protected endpoint.

Sources: [Cron Jobs](https://vercel.com/docs/schedules/cron-jobs); [Usage and pricing limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).

## Odds history and CLV

The Odds API v4 historical endpoint returns the closest odds snapshot at or before a requested ISO-8601 time. The provider documents snapshots at 10-minute intervals initially and 5-minute intervals from September 2022, and limits the historical endpoint to paid usage plans. A real opening/closing comparison therefore requires the relevant historical plan/endpoint and a matched event/book/market/outcome, or app-collected timestamped snapshots before kickoff. A current quote's retrieval time or the earliest update in a current response is not a verified opening/closing line.

Source: [The Odds API v4 documentation](https://the-odds-api.com/liveapi/guides/v4/).

## Dixon–Coles model

The original Dixon–Coles paper describes a parametric model fitted to historical English league/cup football data, based on Poisson regression with time-varying team performance; it reports maximum-likelihood estimation. A fixed low-score tau correction alone is not a fitted, time-decayed Dixon–Coles model. A time-decayed fit requires dated real result rows and a chronological evaluation design; the app's bundled retrospective sample is not a prospective forecast log.

Sources: [Dixon & Coles paper record, Journal of the Royal Statistical Society: Series C](https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065); [Detailed implementation explanation of low-score adjustment and exponential time weighting](https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/).
