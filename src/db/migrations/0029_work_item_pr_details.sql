-- Add display/URL enrichment columns to pr_work_items
-- Also make work_item_id nullable to support "orphan" PRs (PRs without a linked work item)

ALTER TABLE pr_work_items
  ALTER COLUMN work_item_id DROP NOT NULL;

ALTER TABLE pr_work_items
  ADD COLUMN work_item_url   TEXT,
  ADD COLUMN work_item_title TEXT,
  ADD COLUMN pr_url          TEXT,
  ADD COLUMN pr_title        TEXT,
  ADD COLUMN updated_at      TIMESTAMPTZ;
