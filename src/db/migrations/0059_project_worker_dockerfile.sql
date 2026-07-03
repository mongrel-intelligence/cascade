-- Per-project worker Dockerfile (spec 023 plan 1/5).
--
-- Follow-up to spec 022 ("reference a prebuilt worker image"). Here the operator
-- supplies extra Dockerfile layers (RUN/COPY/ENV — never a FROM) and CASCADE
-- builds them on top of the pinned base worker image, on the router's local
-- Docker daemon. The built image is pinned by its immutable LOCAL image ID.
--
-- Adds three nullable text columns. They ship DORMANT: nothing builds, resolves,
-- or launches against them yet (spawn resolution = plan 2, build engine = plan 3,
-- set surfaces = plan 4, UI = plan 5). NULL everywhere = current behavior.
--
-- worker_dockerfile         — operator's extra-layers content (RUN/COPY/ENV lines).
-- worker_image_build_hash   — content-hash of the operator's desired content; the
--                             column/job identity + supersede guard (computed later,
--                             by the set surface in plan 4).
-- worker_image_build_status — status of the most recent (re)build ATTEMPT
--                             ('building' | 'failed'; NULL = idle).
--
-- Column reuse (spec 022 columns, meaning widened for a built image):
--   worker_image        — keeps the REFERENCED ref (NULL for a dockerfile-sourced
--                         project).
--   worker_image_digest — the active launchable PIN for either source: a registry
--                         digest for a referenced image, or the LOCAL image ID for a
--                         built one.
--   worker_image_status — "is there a runnable image + may spawn launch it":
--                         'pending' | 'building' | 'verified' | 'failed'.
--   worker_image_error  — last failure reason.
--
-- Derived source (NOT stored): worker_dockerfile set -> 'dockerfile',
--   else worker_image set -> 'reference', else 'default'.
--
-- Why worker_image_build_status is SPLIT from worker_image_status: this split is
-- load-bearing. It lets a rebuild of a project that already has a verified image
-- run — and even fail — while worker_image_status stays 'verified' on the
-- still-runnable pin, so a failed rebuild never strands a running project.

ALTER TABLE projects ADD COLUMN worker_dockerfile text;
ALTER TABLE projects ADD COLUMN worker_image_build_hash text;
ALTER TABLE projects ADD COLUMN worker_image_build_status text;
