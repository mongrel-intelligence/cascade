-- Migration 0037: Add run_links_enabled to projects
-- Enables per-project opt-in for including dashboard run links in agent comments.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS run_links_enabled BOOLEAN NOT NULL DEFAULT false;
