-- Pre-match prediction log. A row is written once, before kickoff, and its forecast columns are never updated.
-- Only the result columns are filled in later, and only while result is still null.
create table if not exists prediction_log (
  match_id text primary key,
  home text not null,
  away text not null,
  league text not null,
  kickoff_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  model_version text not null,
  input_hash text not null,
  engine_home double precision not null,
  engine_draw double precision not null,
  engine_away double precision not null,
  ai_home double precision not null,
  ai_draw double precision not null,
  ai_away double precision not null,
  final_home double precision not null,
  final_draw double precision not null,
  final_away double precision not null,
  pick text not null check (pick in ('home','draw','away')),
  code text not null,
  tier text not null check (tier in ('A','B','C','PASS')),
  result text check (result in ('home','draw','away')),
  home_goals integer,
  away_goals integer,
  settled_at timestamptz,
  result_source text,
  -- The database itself refuses a forecast recorded at or after kickoff.
  constraint recorded_before_kickoff check (recorded_at < kickoff_at),
  constraint result_and_settled_together check ((result is null) = (settled_at is null))
);

create index if not exists prediction_log_pending_idx on prediction_log (kickoff_at) where result is null;
