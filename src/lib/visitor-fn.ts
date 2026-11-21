import { createServerFn } from "@tanstack/react-start";

const VISITOR_ID = /^[a-z0-9-]{20,80}$/i;

export type VisitorCount = {
  active: number;
  total: number;
  observedAt: string;
};

/**
 * Privacy-preserving presence: the client supplies only a random browser token.
 * No IP address, user agent, name, email or page history is stored.
 */
export const recordVisitorHeartbeat = createServerFn({ method: "POST" })
  .validator((visitorId: string) => {
    if (typeof visitorId !== "string" || !VISITOR_ID.test(visitorId)) throw new Error("Invalid visitor token");
    return visitorId;
  })
  .handler(async ({ data: visitorId }): Promise<VisitorCount> => {
    try {
      const { getSql, ensureDbReady } = await import("@/lib/db");
      await ensureDbReady();
      const sql = await getSql();
      await sql`
        insert into visitor_presence (visitor_id, first_seen_at, last_seen_at)
        values (${visitorId}, now(), now())
        on conflict (visitor_id)
        do update set last_seen_at = excluded.last_seen_at
      `;
      const rows = await sql<{ active: number | string; total: number | string }>`
        select
          count(*) filter (where last_seen_at >= now() - interval '2 minutes') as active,
          count(*) as total
        from visitor_presence
      `;
      return {
        active: Number(rows[0]?.active ?? 0),
        total: Number(rows[0]?.total ?? 0),
        observedAt: new Date().toISOString(),
      };
    } catch {
      return { active: 0, total: 0, observedAt: new Date().toISOString() };
    }
  });
