import { useEffect, useState } from "react";

type Status = {
  generatedAt: string;
  providers: Array<{ id: string; name: string; configured: boolean }>;
  workers: Array<{ jobType: string; status: string; lastRunAt: string | null }>;
};

export function ProviderStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/ops/status", { headers: { accept: "application/json" } })
      .then((response) => response.ok ? response.json() as Promise<Status> : null)
      .then((value) => { if (active && value) setStatus(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const configured = status?.providers.filter((provider) => provider.configured) ?? [];
  const workerFailures = status?.workers.filter((worker) => worker.status === "failed").length ?? 0;
  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3" aria-label="Data coverage status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">Signal desk</p>
          <p className="mt-1 text-sm text-fg">{configured.length} live server integrations configured · {workerFailures ? `${workerFailures} worker failures` : "worker lane ready"}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(status?.providers ?? []).map((provider) => (
            <span key={provider.id} className={`rounded-full border px-2 py-1 text-[11px] ${provider.configured ? "border-emerald-400/60 text-emerald-300" : "border-line text-muted"}`}>
              {provider.name}: {provider.configured ? "connected" : "not configured"}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">Live odds are shown only from configured authorized sources with timestamps. Unavailable sources remain blank; schedule coverage is not odds coverage.</p>
    </section>
  );
}
