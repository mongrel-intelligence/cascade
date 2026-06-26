-- Per-project worker image (spec 022 plan 1/4).
--
-- Adds four nullable worker-image columns to the projects table. They ship
-- dormant: NULL everywhere = current behavior (the global router-level
-- WORKER_IMAGE default), mirroring watchdog_timeout_ms / snapshot_enabled.
--
-- worker_image        — operator-set image reference (tag or digest).
-- worker_image_digest — immutable @sha256: digest pinned at validation time;
--                       the launch uses this digest, not the mutable tag.
-- worker_image_status — validation lifecycle: 'pending' | 'verified' | 'failed'.
-- worker_image_error  — last validation failure reason (human-readable).
--
-- Spawn resolution, validation, CLI/API, and UI land in later plans (2-4).

ALTER TABLE projects ADD COLUMN worker_image text;
ALTER TABLE projects ADD COLUMN worker_image_digest text;
ALTER TABLE projects ADD COLUMN worker_image_status text;
ALTER TABLE projects ADD COLUMN worker_image_error text;
