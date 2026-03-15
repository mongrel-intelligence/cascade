-- Add composite index to optimize aggregated stats queries on the Stats tab.
-- The index covers (project_id, status, started_at DESC) to speed up filtered
-- GROUP BY aggregations in getProjectWorkStatsAggregated.
--
-- CONCURRENTLY cannot run inside a transaction, so this migration should be
-- applied outside a transaction block or in a non-transactional migration runner.

CREATE INDEX CONCURRENTLY idx_agent_runs_project_status_started
  ON agent_runs (project_id, status, started_at DESC);
