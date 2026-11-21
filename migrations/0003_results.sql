create table if not exists settled_results (
  match_id text primary key,
  engine_home double precision not null,
  engine_draw double precision not null,
  engine_away double precision not null,
  ai_home double precision not null,
  ai_draw double precision not null,
  ai_away double precision not null,
  result text not null check (result in ('home','draw','away')),
  settled_at timestamptz not null default now()
);
