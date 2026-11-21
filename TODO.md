# IAN TECH Football Predictions — Delivery Outcomes

## Imported project baseline
- Preserve the uploaded prediction dashboard, existing statistical engine, jackpot UI, performance dashboard, migrations, and tests while removing non-production archive artifacts.
- Keep current source labels, freshness gates, PASS behavior, and responsible-prediction language where they prevent fabricated live data or guaranteed claims.

## Manus AI forecasting layer
- Add a server-side Manus AI analysis path for normalized match evidence, structured explanations, uncertainty factors, alternate scorelines, and model-review notes.
- Keep numeric probabilities governed by validated statistical/ensemble logic; AI output must be bounded, validated, versioned, and unable to turn missing data into a live prediction.

## Expanded prediction features
- Expose at least 21 transparent features/diagnostics spanning team strength, form, home/away splits, goal and xG inputs, player availability, lineups, rest/travel/congestion, motivation, league strength, head-to-head context, weather, score distributions, market probabilities, consensus, movement, calibration, backtesting, freshness, coverage, uncertainty, and risk flags.

## Provider and odds architecture
- Normalize fixtures, results, lineups, statistics, weather, and authorized odds feeds through server-side adapters with source, timestamp, freshness, coverage, and error metadata.
- Recognize documented provider-key aliases, restart-safe server configuration, and report configured provider status from the live server process rather than stale browser assumptions.
- Load all available API-Football fixtures for today and tomorrow, retain the 30-day public schedule fallback, show kickoff/source metadata, and provide explicit Today/Tomorrow filters.
- If API-Football is suspended or The Odds API rejects a credential, continue with the accessible Betika public schedule for upcoming/ready coverage and show the provider error instead of an empty board.
- Match bookmaker events only on exact validated home/away/kickoff identity; never silently substitute another bookmaker, stale price, demo estimate, or schedule-only row.
- Support Betika, SportPesa, 1xBet, and other bookmaker connectors only when an official/licensed/authorized feed and credentials are configured; otherwise show unavailable or manual-entry status.
- Add protected sync/snapshot/settlement job boundaries that can run in one process or be split into workers later.

## Admin and accounts
- Add protected admin configuration for provider keys, league mappings, source priority, refresh intervals, feature flags, AI/model settings, and operational actions.
- Preserve real account sessions and role checks; add Google sign-in configuration where supported without exposing OAuth secrets in the browser.
- Add audit visibility for provider changes, model versions, sync attempts, and admin actions.

## Jackpot and interface
- Keep the curated Betika jackpot event separate from the general Betika football schedule; ordinary bookmaker matches belong under Upcoming/Ready, not Jackpot.
- Keep Jackpot restricted to exact tracked-card matches and never fill missing jackpot games with arbitrary rows from the ordinary Betika schedule; place ordinary matches into their competition under Upcoming/Ready.
- In Live, Ready, Upcoming, and Jackpot, hide long diagnostic/tool copy above the games; show date-grouped current games and their attached prediction details first.
- Display five previous-result circles beside every team in Live, Ready, Upcoming, and Jackpot; use neutral blank circles when verified history is unavailable instead of inventing results.
- Use chronological kickoff order by default, show the final non-PASS prediction as selected on Ready/Upcoming cards, and expose five accuracy checks: recent form, xG gap, market margin, player availability, and engine/AI consensus.
- Improve the jackpot flow with clear source/timestamp chips, exact event matching, one-pick-per-event behavior, confidence/uncertainty presentation, and responsible-gambling copy.
- Improve mobile and desktop hierarchy, provider status, match detail, evidence drill-down, performance, and model-monitor displays without copying proprietary bookmaker code or branding.

## Replit and production deployment
- Add Replit-compatible configuration, Dockerfile, startup/build scripts, health endpoint, migrations, `.env.example`, and deployment documentation.
- Ensure Manus Preview serves `public/manus-routes.json`, uses the configured runtime port, and has no browser-exposed provider secrets.
- Run lint, typecheck, tests, and production build; fix actionable diagnostics before checkpointing.

## Data and safety boundaries
- Do not promise correct scores, guaranteed wins, or certainty.
- Do not bypass CAPTCHAs, login walls, robots restrictions, rate limits, regional controls, or provider terms.
- Keep unavailable integrations visible and honest until the owner supplies credentials and confirms rights.
