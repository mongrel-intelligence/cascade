-- Migration 0036: Remove global and org-level agent configurations
-- Only project-scoped rows (project_id IS NOT NULL) will remain.

-- Step 1: Delete non-project rows
DELETE FROM agent_configs WHERE project_id IS NULL;

-- Step 2: Drop the old partial indexes
DROP INDEX IF EXISTS uq_agent_configs_global;
DROP INDEX IF EXISTS uq_agent_configs_with_project;

-- Step 3: Drop org_id column
ALTER TABLE agent_configs DROP COLUMN IF EXISTS org_id;

-- Step 4: Make project_id NOT NULL
ALTER TABLE agent_configs ALTER COLUMN project_id SET NOT NULL;

-- Step 5: Add simple unique constraint on (project_id, agent_type)
ALTER TABLE agent_configs ADD CONSTRAINT uq_agent_configs_project UNIQUE (project_id, agent_type);
