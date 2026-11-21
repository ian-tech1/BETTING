-- Advanced model probabilities are stored inside prediction_log.source_snapshot.
-- This migration is intentionally additive: existing forecasts remain untouched and
-- older rows correctly report individual-model metrics as unavailable.
comment on column prediction_log.source_snapshot is
  'Immutable provider observations plus advanced model probability snapshots captured before kickoff';
