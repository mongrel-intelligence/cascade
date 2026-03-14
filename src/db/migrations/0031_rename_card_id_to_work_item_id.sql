-- Migration: rename card_id → work_item_id in agent_runs,
--            rename card_budget_usd → work_item_budget_usd in cascade_defaults and projects

-- 1. Rename column in agent_runs
ALTER TABLE agent_runs RENAME COLUMN card_id TO work_item_id;

-- 2. Rename indexes on agent_runs
ALTER INDEX idx_agent_runs_card_id RENAME TO idx_agent_runs_work_item_id;
ALTER INDEX idx_agent_runs_project_card RENAME TO idx_agent_runs_project_work_item;

-- 3. Rename column in cascade_defaults
ALTER TABLE cascade_defaults RENAME COLUMN card_budget_usd TO work_item_budget_usd;

-- 4. Rename column in projects
ALTER TABLE projects RENAME COLUMN card_budget_usd TO work_item_budget_usd;
