import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";
import { isAdmin } from "@/lib/ops.server";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (!isAdmin(user.id)) return { response: Response.json({ error: "Admin role required." }, { status: 403 }) } as const;
  return { user } as const;
}

export const Route = createFileRoute("/api/admin/providers")({
  server: {
    handlers: {
      GET: async () => {
        const auth = await requireAdmin();
        if ("response" in auth) return auth.response;
        const sql = await getSql();
        const rows = await sql.query("select provider, enabled, display_name, league_map, refresh_seconds, settings, updated_by, updated_at from provider_configs order by display_name");
        return Response.json({ providers: rows }, { headers: { "Cache-Control": "no-store" } });
      },
      PUT: async ({ request }) => {
        const auth = await requireAdmin();
        if ("response" in auth) return auth.response;
        const body = await request.json() as { provider?: string; enabled?: boolean; leagueMap?: Record<string, unknown>; refreshSeconds?: number; settings?: Record<string, unknown> };
        const provider = typeof body.provider === "string" ? body.provider.trim().slice(0, 80) : "";
        if (!provider || !/^[a-z0-9-]+$/.test(provider)) return Response.json({ error: "Invalid provider id." }, { status: 400 });
        const refreshSeconds = Number(body.refreshSeconds ?? 300);
        if (!Number.isInteger(refreshSeconds) || refreshSeconds < 30 || refreshSeconds > 86400) return Response.json({ error: "Refresh interval must be 30–86400 seconds." }, { status: 400 });
        const sql = await getSql();
        await sql.query(
          "insert into provider_configs (provider, enabled, display_name, league_map, refresh_seconds, settings, updated_by, updated_at) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,now()) on conflict (provider) do update set enabled=excluded.enabled, league_map=excluded.league_map, refresh_seconds=excluded.refresh_seconds, settings=excluded.settings, updated_by=excluded.updated_by, updated_at=now()",
          [provider, Boolean(body.enabled), provider, JSON.stringify(body.leagueMap ?? {}), refreshSeconds, JSON.stringify(body.settings ?? {}), auth.user.id],
        );
        await sql.query("insert into admin_audit_events (actor_id, action, target, metadata) values ($1,$2,$3,$4::jsonb)", [auth.user.id, "provider_config.update", provider, JSON.stringify({ enabled: Boolean(body.enabled), refreshSeconds })]);
        return Response.json({ ok: true, provider });
      },
    },
  },
});
