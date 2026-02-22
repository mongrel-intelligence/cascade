CREATE TABLE pr_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  work_item_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pr_work_items_project_pr UNIQUE (project_id, pr_number)
);
CREATE INDEX idx_pr_work_items_work_item ON pr_work_items (work_item_id);
