-- Add composite index to optimize aggregated stats queries on the Stats tab.
-- The index covers (project_id, status, started_at DESC) to speed up filtered
-- GROUP BY aggregations in getProjectWorkStatsAggregated.

CREATE INDEX idx_agent_runs_project_status_started
  ON agent_runs (project_id, status, started_at DESC);
