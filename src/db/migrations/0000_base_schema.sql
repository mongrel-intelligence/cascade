-- Base Schema
-- Creates the initial tables needed before the incremental migration chain (0001+).
-- This migration is only applied to fresh databases.

BEGIN;

-- Projects (original schema before 0001)
CREATE TABLE IF NOT EXISTS "projects" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "repo" text NOT NULL,
    "base_branch" text,
    "branch_prefix" text,
    "model" text,
    "card_budget_usd" numeric(10, 2),
    "agent_backend_default" text,
    "github_token_env" text,
    "reviewer_token_env" text,
    "trello_board_id" text,
    "trello_lists" jsonb,
    "trello_labels" jsonb,
    "trello_custom_fields" jsonb,
    "triggers" jsonb,
    "agent_models" jsonb,
    "agent_backend_overrides" jsonb,
    "prompts" jsonb,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_repo" ON "projects" ("repo");
CREATE INDEX IF NOT EXISTS "idx_projects_trello_board_id" ON "projects" ("trello_board_id");

-- Project secrets (original credential storage, replaced in 0003)
CREATE TABLE IF NOT EXISTS "project_secrets" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "key" text NOT NULL,
    "value" text NOT NULL,
    "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_secrets_project_key"
    ON "project_secrets" ("project_id", "key");

-- Cascade defaults (original schema before 0005)
CREATE TABLE IF NOT EXISTS "cascade_defaults" (
    "id" serial PRIMARY KEY NOT NULL,
    "model" text,
    "max_iterations" integer,
    "watchdog_timeout_ms" integer,
    "card_budget_usd" numeric(10, 2),
    "agent_backend" text,
    "progress_model" text,
    "progress_interval_minutes" numeric(5, 1),
    "agent_models" jsonb,
    "agent_iterations" jsonb,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

COMMIT;
