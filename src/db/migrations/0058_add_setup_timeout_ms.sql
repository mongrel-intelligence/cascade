-- Add setup_timeout_ms column to projects table.
-- NULL (or 0) means no per-project wall timeout for .cascade/setup.sh —
-- rely on the global worker/watchdog container timeout (current behaviour).
-- A positive value is passed as wallTimeoutMs to the setup.sh runCommand call.
ALTER TABLE projects ADD COLUMN setup_timeout_ms INTEGER DEFAULT NULL;
