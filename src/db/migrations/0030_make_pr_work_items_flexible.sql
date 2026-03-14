-- Make pr_number and repo_full_name nullable so PM-triggered runs can insert
-- a work-item-only row before a PR exists. When the agent creates a PR,
-- the existing row is updated with PR data via linkPRToWorkItem.

ALTER TABLE pr_work_items ALTER COLUMN pr_number DROP NOT NULL;
ALTER TABLE pr_work_items ALTER COLUMN repo_full_name DROP NOT NULL;

-- Drop the old unique constraint on (project_id, pr_number) — it no longer
-- makes sense when pr_number can be NULL (multiple NULLs pass UNIQUE).
ALTER TABLE pr_work_items DROP CONSTRAINT IF EXISTS uq_pr_work_items_project_pr;

-- Partial unique index: enforce uniqueness only when pr_number IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_work_items_project_pr
    ON pr_work_items (project_id, pr_number)
    WHERE pr_number IS NOT NULL;

-- Partial unique index: one work-item-only row per (project_id, work_item_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_work_items_project_work_item
    ON pr_work_items (project_id, work_item_id)
    WHERE work_item_id IS NOT NULL AND pr_number IS NULL;

-- Index for dual-join lookups by (project_id, work_item_id)
CREATE INDEX IF NOT EXISTS idx_pr_work_items_project_work_item
    ON pr_work_items (project_id, work_item_id);
