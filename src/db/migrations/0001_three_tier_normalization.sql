-- Three-Tier Normalization Migration
-- Migrates from JSONB columns to individual columns + agent_configs table

BEGIN;

-- 1. Create agent_configs table
CREATE TABLE IF NOT EXISTS "agent_configs" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" text,
    "agent_type" text NOT NULL,
    "model" text,
    "max_iterations" integer,
    "backend" text,
    "prompt" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "uq_agent_configs_project_agent" UNIQUE("project_id", "agent_type")
);

ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;

-- 2. Add new individual columns to projects
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_briefing" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_stories" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_planning" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_todo" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_in_progress" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_in_review" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_done" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_merged" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_list_debug" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_label_ready_to_process" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_label_processing" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_label_processed" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_label_error" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trello_custom_field_cost" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "subscription_cost_zero" boolean DEFAULT false;

-- 3. Migrate data from JSONB columns to individual columns

-- Trello lists
UPDATE "projects" SET
    "trello_list_briefing" = "trello_lists"->>'briefing',
    "trello_list_stories" = "trello_lists"->>'stories',
    "trello_list_planning" = "trello_lists"->>'planning',
    "trello_list_todo" = "trello_lists"->>'todo',
    "trello_list_in_progress" = "trello_lists"->>'inProgress',
    "trello_list_in_review" = "trello_lists"->>'inReview',
    "trello_list_done" = "trello_lists"->>'done',
    "trello_list_merged" = "trello_lists"->>'merged',
    "trello_list_debug" = "trello_lists"->>'debug'
WHERE "trello_lists" IS NOT NULL;

-- Trello labels
UPDATE "projects" SET
    "trello_label_ready_to_process" = "trello_labels"->>'readyToProcess',
    "trello_label_processing" = "trello_labels"->>'processing',
    "trello_label_processed" = "trello_labels"->>'processed',
    "trello_label_error" = "trello_labels"->>'error'
WHERE "trello_labels" IS NOT NULL;

-- Trello custom fields
UPDATE "projects" SET
    "trello_custom_field_cost" = "trello_custom_fields"->>'cost'
WHERE "trello_custom_fields" IS NOT NULL;

-- 4. Migrate global agent_models and agent_iterations from cascade_defaults → agent_configs
-- agent_models: {"agentType": "modelName"}
INSERT INTO "agent_configs" ("project_id", "agent_type", "model")
SELECT NULL, kv.key, kv.value #>> '{}'
FROM "cascade_defaults" d, jsonb_each(d."agent_models") AS kv(key, value)
WHERE d."agent_models" IS NOT NULL
ON CONFLICT ("project_id", "agent_type") DO UPDATE SET "model" = EXCLUDED."model";

-- agent_iterations: {"agentType": iterationCount}
-- Update existing rows or insert new ones
INSERT INTO "agent_configs" ("project_id", "agent_type", "max_iterations")
SELECT NULL, kv.key, (kv.value #>> '{}')::integer
FROM "cascade_defaults" d, jsonb_each(d."agent_iterations") AS kv(key, value)
WHERE d."agent_iterations" IS NOT NULL
ON CONFLICT ("project_id", "agent_type") DO UPDATE SET "max_iterations" = EXCLUDED."max_iterations";

-- 5. Migrate per-project agent_models → agent_configs
INSERT INTO "agent_configs" ("project_id", "agent_type", "model")
SELECT p."id", kv.key, kv.value #>> '{}'
FROM "projects" p, jsonb_each(p."agent_models") AS kv(key, value)
WHERE p."agent_models" IS NOT NULL
ON CONFLICT ("project_id", "agent_type") DO UPDATE SET "model" = EXCLUDED."model";

-- 6. Migrate per-project agent_backend_overrides → agent_configs.backend
INSERT INTO "agent_configs" ("project_id", "agent_type", "backend")
SELECT p."id", kv.key, kv.value #>> '{}'
FROM "projects" p, jsonb_each(p."agent_backend_overrides") AS kv(key, value)
WHERE p."agent_backend_overrides" IS NOT NULL
ON CONFLICT ("project_id", "agent_type") DO UPDATE SET "backend" = EXCLUDED."backend";

-- 7. Migrate per-project prompts → agent_configs.prompt
INSERT INTO "agent_configs" ("project_id", "agent_type", "prompt")
SELECT p."id", kv.key, kv.value #>> '{}'
FROM "projects" p, jsonb_each(p."prompts") AS kv(key, value)
WHERE p."prompts" IS NOT NULL
ON CONFLICT ("project_id", "agent_type") DO UPDATE SET "prompt" = EXCLUDED."prompt";

-- 8. Drop old JSONB columns from projects
ALTER TABLE "projects" DROP COLUMN IF EXISTS "github_token_env";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "reviewer_token_env";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "trello_lists";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "trello_labels";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "trello_custom_fields";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "triggers";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "agent_models";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "agent_backend_overrides";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "prompts";

-- 9. Drop old JSONB columns from cascade_defaults
ALTER TABLE "cascade_defaults" DROP COLUMN IF EXISTS "agent_models";
ALTER TABLE "cascade_defaults" DROP COLUMN IF EXISTS "agent_iterations";

COMMIT;
