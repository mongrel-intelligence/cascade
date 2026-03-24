-- Add per-project snapshot policy columns to projects table.
-- NULL means fall back to router-level defaults.
-- snapshot_enabled: when NULL, router default (false) applies.
-- snapshot_ttl_ms: when NULL, router default applies.

ALTER TABLE projects ADD COLUMN snapshot_enabled BOOLEAN DEFAULT NULL;
ALTER TABLE projects ADD COLUMN snapshot_ttl_ms INTEGER DEFAULT NULL;
