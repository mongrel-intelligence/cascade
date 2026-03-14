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
UPDATE projects
SET
  max_iterations = COALESCE(projects.max_iterations, cd.max_iterations),
  watchdog_timeout_ms = COALESCE(projects.watchdog_timeout_ms, cd.watchdog_timeout_ms),
  progress_model = COALESCE(projects.progress_model, cd.progress_model),
  progress_interval_minutes = COALESCE(projects.progress_interval_minutes, cd.progress_interval_minutes)
FROM cascade_defaults cd
WHERE projects.org_id = cd.org_id
  AND (
    projects.max_iterations IS NULL
    OR projects.watchdog_timeout_ms IS NULL
    OR projects.progress_model IS NULL
    OR projects.progress_interval_minutes IS NULL
  );

-- Step 3: Drop the cascade_defaults table
DROP TABLE IF EXISTS cascade_defaults;
