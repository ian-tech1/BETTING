# Deployment

## Manus

The project is configured as a full-stack Manus Webdev project with server and managed database capabilities. Add provider credentials through the project's protected secret manager. The app never reads provider keys in browser code. `/api/health` is the unauthenticated readiness endpoint and `/api/ops/status` reports safe provider/worker coverage.

## Replit

Import the repository into Replit, keep the included `.replit`, `Dockerfile`, `startup.sh`, `package.json`, lockfile, and `migrations/` directory, then add the values from `.env.example` in Replit Secrets. The build uses Nitro's portable Node server output; use `npm run build` for the build and `npm run start` for the run command. Replit must provide a hosted Postgres URL for durable logs, user sessions, provider observations, and admin configuration. `APP_POSTGRES_URL` is the recommended explicit variable; a normal Postgres `DATABASE_URL` also works on Replit. On Manus, do not use the platform-managed MySQL/TiDB `DATABASE_URL` with this imported Postgres schema; add `APP_POSTGRES_URL` through protected secrets instead.

## Provider activation

Configure only providers for which you have an API key and the right to consume or republish the data. The bookmaker-specific variables are intentionally separate. An unavailable feed is shown as unavailable; the app does not scrape through CAPTCHAs, login walls, robots restrictions, rate limits, regional controls, or terms that prohibit republication.

## Manus AI

Managed Manus deployments provide `MANUS_API_URL` and `MANUS_API_KEY`. For Replit, use an authorized server-side Manus API credential if your account/project supplies one. If Manus AI is unavailable, the statistical engine and PASS/freshness gates continue to operate without fabricating AI output.

## Admin configuration

Set `ADMIN_USER_IDS` to a comma-separated list of authenticated app user IDs after the first real login. Use the protected admin surface to manage provider metadata, source priority, refresh cadence, model flags, and worker operations. Never paste secret values into source files, Git, issue trackers, or chat.
