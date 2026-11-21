create table if not exists provider_configs (
  provider text primary key,
  enabled boolean not null default false,
  display_name text not null,
  league_map jsonb not null default '{}'::jsonb,
  refresh_seconds integer not null default 300 check (refresh_seconds between 30 and 86400),
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists job_runs (
  id bigserial primary key,
  job_type text not null check (job_type in ('fixture-sync','odds-snapshot','prediction-refresh','result-settlement','ai-analysis')),
  status text not null check (status in ('queued','running','succeeded','failed')),
  provider text,
  started_at timestamptz,
  finished_at timestamptz,
  rows_affected integer not null default 0,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists job_runs_type_time_idx on job_runs (job_type, created_at desc);

create table if not exists admin_audit_events (
  id bigserial primary key,
  actor_id text not null,
  action text not null,
  target text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_events_time_idx on admin_audit_events (created_at desc);

insert into provider_configs (provider, enabled, display_name)
values
  ('manus-ai', true, 'Manus AI'),
  ('odds-api', false, 'The Odds API'),
  ('api-football', false, 'API-Football'),
  ('football-data', false, 'Football-Data.org'),
  ('betika-authorized', false, 'Betika authorized feed'),
  ('sportpesa-authorized', false, 'SportPesa authorized feed'),
  ('1xbet-authorized', false, '1xBet authorized feed')
on conflict (provider) do nothing;
