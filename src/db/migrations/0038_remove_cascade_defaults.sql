-- Migration: Move cascade_defaults columns into projects table
-- and drop the cascade_defaults table.

-- Step 1: Add new columns to projects table
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS max_iterations integer,
  ADD COLUMN IF NOT EXISTS watchdog_timeout_ms integer,
  ADD COLUMN IF NOT EXISTS progress_model text,
  ADD COLUMN IF NOT EXISTS progress_interval_minutes numeric(5,1);

-- Step 2: Copy values from cascade_defaults into every project in the same org
-- (only fills in NULL values to avoid overwriting project-level overrides)
-- Covers all 8 columns that cascade_defaults stored:
--   4 new columns (added above): max_iterations, watchdog_timeout_ms, progress_model, progress_interval_minutes
--   4 pre-existing columns on projects: model, work_item_budget_usd, agent_engine, agent_engine_settings
UPDATE projects
SET
  max_iterations = COALESCE(projects.max_iterations, cd.max_iterations),
  watchdog_timeout_ms = COALESCE(projects.watchdog_timeout_ms, cd.watchdog_timeout_ms),
  progress_model = COALESCE(projects.progress_model, cd.progress_model),
  progress_interval_minutes = COALESCE(projects.progress_interval_minutes, cd.progress_interval_minutes),
  model = COALESCE(projects.model, cd.model),
  work_item_budget_usd = COALESCE(projects.work_item_budget_usd, cd.work_item_budget_usd),
  agent_engine = COALESCE(projects.agent_engine, cd.agent_engine),
  agent_engine_settings = COALESCE(projects.agent_engine_settings, cd.agent_engine_settings)
FROM cascade_defaults cd
WHERE projects.org_id = cd.org_id
  AND (
    projects.max_iterations IS NULL
    OR projects.watchdog_timeout_ms IS NULL
    OR projects.progress_model IS NULL
    OR projects.progress_interval_minutes IS NULL
    OR projects.model IS NULL
    OR projects.work_item_budget_usd IS NULL
    OR projects.agent_engine IS NULL
    OR projects.agent_engine_settings IS NULL
  );

-- Step 3: Drop the cascade_defaults table
DROP TABLE IF EXISTS cascade_defaults;
