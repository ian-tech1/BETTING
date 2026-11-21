# IAN TECH Football Predictions — Upgrade Plan

## Product direction

Upgrade the existing React/Vite football prediction dashboard into a production-ready, provider-aware forecasting platform powered by Manus AI. The app will show verified live data when configured, clearly label manual or unavailable sources, and never present a guaranteed score or guaranteed betting outcome.

## Implementation approach

- Preserve and extend the existing prediction engine, jackpot, odds adapters, migrations, performance dashboard, and account-scoped desk state.
- Add a server-side provider orchestration layer for fixtures, results, statistics, lineups, weather, and authorized odds feeds. Each adapter returns normalized events, source metadata, freshness, and coverage status.
- Add a Manus AI structured-analysis service that receives normalized match evidence and returns bounded explanations, uncertainty factors, alternate scorelines, and model-review notes. The statistical engine remains the source of numeric probabilities; AI cannot override missing-data gates.
- Add a worker-oriented job boundary with separate sync, odds snapshot, prediction, settlement, and AI-analysis jobs. In a single Replit/Manus process these run as protected endpoints or an internal queue abstraction; deployment can later split them into workers without rewriting domain logic.
- Add admin configuration for provider declarations, league mappings, refresh schedules, model feature flags, AI settings, source priority, and role-gated operational actions. Secrets stay in environment variables or the hosting secret manager, never in browser code or Git.
- Add Replit deployment files: `.replit`, `replit.nix`/runtime guidance as needed, `Dockerfile`, `start`/`build` compatibility, health endpoint, and `.env.example`.
- Keep Google sign-in configuration compatible with the existing auth foundation and the Manus OAuth default; any provider-specific OAuth values are admin/deployment secrets.

## Prediction upgrades

The model presentation will expose at least 21 transparent inputs or diagnostics: Elo/team strength, recent form, home/away splits, goals for/against, expected goals when available, shot quality, possession/territory, injuries, suspensions, confirmed lineups, bench depth, rest days, travel load, fixture congestion, motivation/table pressure, league-strength adjustment, head-to-head context, weather/pitch context, Poisson/Dixon–Coles score distribution, market-implied probabilities, multi-book consensus, odds movement, ensemble agreement, uncertainty intervals, calibration history, backtest metrics, data freshness, sample coverage, and risk flags.

## Data and compliance boundaries

Bookmaker parity is implemented only through official, licensed, or user-authorized APIs/feeds. The app will not bypass CAPTCHAs, login walls, robots restrictions, rate limits, regional controls, or terms prohibiting republication. A missing bookmaker feed remains unavailable or manual-entry only; it is never replaced with invented odds.

## Design

### Considered styles

- **Broadcast Control Room (0.07):** dense live-data panels, scoreboard typography, and signal colors for source confidence.
- **Editorial Analytics (0.05):** restrained magazine layout with narrative match briefs and calm charts.
- **Night Matchday Terminal (0.08):** dark pitch-inspired canvas, luminous green accents, and compact high-signal cards.

### Selected style: Night Matchday Terminal

- **Design Movement:** premium football broadcast terminal with modern sportsbook clarity, not a clone of any bookmaker app.
- **Core Principles:** evidence before excitement; one clear decision per card; visible freshness and uncertainty; fast scanning on mobile.
- **Color Philosophy:** deep charcoal and pitch green create a focused match-night atmosphere; amber marks data caveats and violet marks AI commentary; red is reserved for risk, stale data, or unavailable sources.
- **Layout Paradigm:** asymmetric dashboard with a dominant “today’s board” rail, a match-detail workspace, and a persistent evidence/status strip rather than a centered marketing grid.
- **Signature Elements:** thin pitch-line dividers, confidence rings, and source-status chips with timestamp/age.
- **Interaction Philosophy:** progressive disclosure—summary first, then evidence, then model internals; every automated choice can be traced to inputs.
- **Animation:** restrained 150–220ms transitions for tabs and confidence changes; no celebratory win animations; loading states show source-by-source progress.
- **Typography System:** Inter or system sans for UI; tabular numerals for odds and probabilities; condensed display weight only for matchday headlines.
- **Brand Essence:** a transparent match-analysis desk for serious football fans who want evidence, not certainty. Personality: analytical, direct, responsible.
- **Brand Voice:** “Signal, not certainty.” and “Every price carries a source and a timestamp.”
- **Wordmark & Logo:** IAN TECH wordmark paired with a compact split-pitch signal mark.
- **Signature Brand Color:** electric pitch green used sparingly for verified, actionable signals.

## Project structure

- `src/components/`: dashboard, match, jackpot, admin, provider status, and model-monitor views.
- `src/lib/`: prediction engines, normalized provider adapters, Manus AI client, auth/roles, persistence, and shared validation.
- `src/routes/api/`: read-only predictions plus protected admin, sync, odds, AI, health, and worker endpoints.
- `migrations/`: additive schema for users/roles, provider configs, normalized fixtures, odds observations, prediction versions, AI analyses, jobs, and audit events.
- `scripts/`: migrations, local setup, checks, and Replit-compatible startup helpers.
- `public/`: route manifest, favicon, and static metadata.

## Delivery shape

The main deliverable is a working Manus project with preview/checkpoint readiness plus a Replit-compatible source tree. Live odds and Google OAuth become active after the owner supplies corresponding credentials and confirms provider rights; the app remains honest and usable without them.