# IAN TECH Football Predictions

A production-ready football analysis dashboard with optional real account sign-in, protected admin configuration, and Replit/Manus deployment files. Picks, manual jackpot rows, bankroll settings, and slips stay in the current browser profile. Optional server-side Postgres storage records frozen forecasts and later outcomes for accuracy reporting and model recalibration.

The app combines its statistical engine, bounded Manus AI review, and verified provider inputs into one reconciled 1X2 conclusion. If required current team data is missing or stale, it returns **PASS** rather than presenting unverified figures as a live forecast. No model can guarantee 100% accuracy or a winning bet.

## Deploy

1. Import the repository into Replit or use the initialized Manus project; use `npm run build` and `npm run start` for production.
2. Add `APP_POSTGRES_URL` (or a Postgres-compatible `DATABASE_URL` on Replit) for durable logs, auth sessions, provider observations, and model learning. Without a hosted Postgres database, the site still serves but storage is ephemeral/unconfigured.
3. Add `MANUS_API_URL`/`MANUS_API_KEY` and optional server-side provider keys only for integrations you intend to use and are authorized to consume.
4. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) and [SETUP.md](./SETUP.md) for environment variables, migrations, source-coverage limits, and verification.

The public read-only endpoint is `GET /api/predictions` (optional `?limit=100`).

## Local checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The bundled fixture calendar in this archive is dated 7–8 November 2026 and is now historical. Refresh the supported fixture feed before treating any match as upcoming.
