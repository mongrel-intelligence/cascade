-- Migration 0005: Configuration Schema Cleanup
--
-- 1. Drop dead project_secrets table
-- 2. Restructure cascade_defaults PK (drop id, promote org_id)
-- 3. Rename backend → agent_backend in agent_configs
-- 4. Rename agent_backend_default → agent_backend in projects
-- 5. Standardize index naming (idx_projects_repo → uq_projects_repo)
-- 6. Extract Trello config into project_integrations table
-- 7. Drop Trello columns from projects

-- ============================================================
-- 1. Drop dead project_secrets table
-- ============================================================
DROP TABLE IF EXISTS "project_secrets";

-- ============================================================
-- 2. Restructure cascade_defaults: drop id, make org_id the PK
-- ============================================================
-- org_id is already NOT NULL UNIQUE, so promote it to PK
ALTER TABLE "cascade_defaults" DROP CONSTRAINT IF EXISTS "cascade_defaults_pkey";
ALTER TABLE "cascade_defaults" DROP COLUMN IF EXISTS "id";
ALTER TABLE "cascade_defaults" ADD PRIMARY KEY ("org_id");

-- Add created_at (every other table has it)
ALTER TABLE "cascade_defaults" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

-- ============================================================
-- 3. Rename backend → agent_backend in agent_configs
-- ============================================================
ALTER TABLE "agent_configs" RENAME COLUMN "backend" TO "agent_backend";

-- ============================================================
-- 4. Rename agent_backend_default → agent_backend in projects
-- ============================================================
ALTER TABLE "projects" RENAME COLUMN "agent_backend_default" TO "agent_backend";

-- ============================================================
-- 5. Standardize index naming
-- ============================================================
ALTER INDEX IF EXISTS "idx_projects_repo" RENAME TO "uq_projects_repo";

-- ============================================================
-- 6. Create project_integrations table
-- ============================================================
CREATE TABLE IF NOT EXISTS "project_integrations" (
    "id" serial PRIMARY KEY,
    "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "config" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_integrations_project_type"
    ON "project_integrations" ("project_id", "type");

-- ============================================================
-- 7. Migrate Trello data from flat columns to JSONB
-- ============================================================
INSERT INTO "project_integrations" ("project_id", "type", "config")
SELECT
    "id",
    'trello',
    jsonb_strip_nulls(jsonb_build_object(
        'boardId', "trello_board_id",
        'lists', jsonb_strip_nulls(jsonb_build_object(
            'briefing', "trello_list_briefing",
            'stories', "trello_list_stories",
            'planning', "trello_list_planning",
            'todo', "trello_list_todo",
            'inProgress', "trello_list_in_progress",
            'inReview', "trello_list_in_review",
            'done', "trello_list_done",
            'merged', "trello_list_merged",
            'debug', "trello_list_debug"
        )),
        'labels', jsonb_strip_nulls(jsonb_build_object(
            'readyToProcess', "trello_label_ready_to_process",
            'processing', "trello_label_processing",
            'processed', "trello_label_processed",
            'error', "trello_label_error"
        )),
        'customFields', CASE
            WHEN "trello_custom_field_cost" IS NOT NULL
            THEN jsonb_build_object('cost', "trello_custom_field_cost")
            ELSE NULL
        END
    ))
FROM "projects"
WHERE "trello_board_id" IS NOT NULL;

-- ============================================================
-- 8. Drop Trello columns from projects
-- ============================================================
ALTER TABLE "projects"
    DROP COLUMN IF EXISTS "trello_board_id",
    DROP COLUMN IF EXISTS "trello_list_briefing",
    DROP COLUMN IF EXISTS "trello_list_stories",
    DROP COLUMN IF EXISTS "trello_list_planning",
    DROP COLUMN IF EXISTS "trello_list_todo",
    DROP COLUMN IF EXISTS "trello_list_in_progress",
    DROP COLUMN IF EXISTS "trello_list_in_review",
    DROP COLUMN IF EXISTS "trello_list_done",
    DROP COLUMN IF EXISTS "trello_list_merged",
    DROP COLUMN IF EXISTS "trello_list_debug",
    DROP COLUMN IF EXISTS "trello_label_ready_to_process",
    DROP COLUMN IF EXISTS "trello_label_processing",
    DROP COLUMN IF EXISTS "trello_label_processed",
    DROP COLUMN IF EXISTS "trello_label_error",
    DROP COLUMN IF EXISTS "trello_custom_field_cost";

DROP INDEX IF EXISTS "idx_projects_trello_board_id";

-- ============================================================
-- 9. Expression index for Trello board lookup via integrations
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_pi_trello_board"
    ON "project_integrations" ((config->>'boardId'))
    WHERE "type" = 'trello';
