-- Supplemental observations are separate from the immutable pre-match forecast ledger.
-- These rows contain provider data only; no account or personal fields are stored.
create table if not exists historical_match_results (
  provider text not null,
  fixture_id text not null,
  league_code text,
  league_name text not null,
  season integer,
  kickoff_at timestamptz not null,
  home_id text not null,
  home_name text not null,
  away_id text not null,
  away_name text not null,
  home_goals integer not null check (home_goals >= 0),
  away_goals integer not null check (away_goals >= 0),
  regulation_time boolean not null default true,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  primary key (provider, fixture_id),
  check (home_id <> away_id)
);
create index if not exists historical_match_results_league_time_idx
  on historical_match_results (league_code, kickoff_at desc);
create index if not exists historical_match_results_team_time_idx
  on historical_match_results (home_id, away_id, kickoff_at desc);

create table if not exists lineup_observations (
  id bigserial primary key,
  match_id text not null,
  provider text not null,
  provider_match_id text,
  status text not null check (status in ('confirmed', 'not-announced', 'coverage-unavailable', 'identity-unverified', 'provider-error')),
  kickoff_at timestamptz not null,
  observed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique (match_id, provider, observed_at)
);
create index if not exists lineup_observations_latest_idx
  on lineup_observations (match_id, observed_at desc);

create table if not exists odds_observations (
  id bigserial primary key,
  match_id text not null,
  provider text not null,
  event_id text not null,
  bookmaker_key text not null,
  bookmaker_name text not null,
  market text not null check (market = 'h2h'),
  kickoff_at timestamptz not null,
  captured_at timestamptz not null default now(),
  provider_updated_at timestamptz,
  home_odds double precision not null check (home_odds > 1),
  draw_odds double precision not null check (draw_odds > 1),
  away_odds double precision not null check (away_odds > 1),
  unique (match_id, provider, event_id, bookmaker_key, market, captured_at)
);
create index if not exists odds_observations_match_time_idx
  on odds_observations (match_id, captured_at desc);

create table if not exists weather_observations (
  id bigserial primary key,
  match_id text not null,
  provider text not null default 'open-meteo',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  observed_at timestamptz not null default now(),
  valid_at timestamptz not null,
  variables jsonb not null,
  unique (match_id, provider, valid_at, observed_at)
);
create index if not exists weather_observations_match_time_idx
  on weather_observations (match_id, valid_at desc);

create table if not exists standings_observations (
  id bigserial primary key,
  match_id text not null,
  provider text not null,
  league_id text not null,
  team_id text not null,
  season integer not null,
  observed_at timestamptz not null default now(),
  position integer,
  points integer,
  played integer,
  games_left integer,
  unique (match_id, provider, team_id, observed_at)
);
create index if not exists standings_observations_latest_idx
  on standings_observations (match_id, observed_at desc);

alter table prediction_log
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb;

-- A forecast's model inputs and probabilities are immutable after insertion.
-- The result section can be filled once, only while the row is unsettled.
create or replace function protect_prediction_log_update() returns trigger as $$
begin
  if row(
    new.match_id, new.home, new.away, new.league, new.kickoff_at, new.recorded_at,
    new.model_version, new.input_hash, new.engine_home, new.engine_draw, new.engine_away,
    new.ai_home, new.ai_draw, new.ai_away, new.final_home, new.final_draw, new.final_away,
    new.pick, new.code, new.tier, new.source_snapshot
  ) is distinct from row(
    old.match_id, old.home, old.away, old.league, old.kickoff_at, old.recorded_at,
    old.model_version, old.input_hash, old.engine_home, old.engine_draw, old.engine_away,
    old.ai_home, old.ai_draw, old.ai_away, old.final_home, old.final_draw, old.final_away,
    old.pick, old.code, old.tier, old.source_snapshot
  ) then
    raise exception 'prediction forecast columns are immutable';
  end if;
  if old.result is not null and row(new.result, new.home_goals, new.away_goals, new.settled_at, new.result_source)
       is distinct from row(old.result, old.home_goals, old.away_goals, old.settled_at, old.result_source) then
    raise exception 'settled prediction result is immutable';
  end if;
  if old.result is null and new.result is null and row(new.home_goals, new.away_goals, new.settled_at, new.result_source)
       is distinct from row(old.home_goals, old.away_goals, old.settled_at, old.result_source) then
    raise exception 'result fields may only be written when settling';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists prediction_log_immutable_update on prediction_log;
create trigger prediction_log_immutable_update
before update on prediction_log
for each row execute function protect_prediction_log_update();
