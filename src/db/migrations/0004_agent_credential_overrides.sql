-- Agent Credential Overrides Migration
-- Adds optional agent_type column to project_credential_overrides,
-- enabling per-agent credential overrides (e.g. review agent uses a different GITHUB_TOKEN).
-- Migrates existing GITHUB_REVIEWER_TOKEN credentials to agent-scoped GITHUB_TOKEN overrides.

BEGIN;

-- 1. Add agent_type column (nullable = project-wide override when NULL)
ALTER TABLE "project_credential_overrides"
    ADD COLUMN IF NOT EXISTS "agent_type" text;

-- 2. Drop old unique index (project_id, env_var_key) — replaced by two partial indexes
DROP INDEX IF EXISTS "uq_project_credential_overrides_project_env_var_key";

-- 3. Create partial unique indexes
-- Project-wide overrides: one per (project_id, env_var_key) when agent_type is NULL
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pco_project_env_var_key"
    ON "project_credential_overrides" ("project_id", "env_var_key")
    WHERE "agent_type" IS NULL;

-- Agent-scoped overrides: one per (project_id, env_var_key, agent_type)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pco_project_env_var_key_agent_type"
    ON "project_credential_overrides" ("project_id", "env_var_key", "agent_type")
    WHERE "agent_type" IS NOT NULL;

-- 4. Migrate GITHUB_REVIEWER_TOKEN → agent-scoped GITHUB_TOKEN overrides
-- For each project that has a GITHUB_REVIEWER_TOKEN (via project override OR org default),
-- create agent-scoped GITHUB_TOKEN overrides for review-related agent types.
DO $$
DECLARE
    r RECORD;
    agent TEXT;
    reviewer_agents TEXT[] := ARRAY['review', 'respond-to-review', 'respond-to-pr-comment', 'respond-to-ci'];
BEGIN
    -- Case 1: Projects with explicit GITHUB_REVIEWER_TOKEN project overrides
    FOR r IN
        SELECT pco."project_id", c."id" AS credential_id
        FROM "project_credential_overrides" pco
        INNER JOIN "credentials" c ON c."id" = pco."credential_id"
        WHERE pco."env_var_key" = 'GITHUB_REVIEWER_TOKEN'
          AND pco."agent_type" IS NULL
    LOOP
        FOREACH agent IN ARRAY reviewer_agents
        LOOP
            INSERT INTO "project_credential_overrides"
                ("project_id", "env_var_key", "credential_id", "agent_type")
            VALUES (r.project_id, 'GITHUB_TOKEN', r.credential_id, agent)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Case 2: Projects using org-default GITHUB_REVIEWER_TOKEN (no project override)
    -- Find org defaults for GITHUB_REVIEWER_TOKEN and create agent-scoped overrides
    -- for all projects in that org that don't already have a project-level override.
    FOR r IN
        SELECT p."id" AS project_id, c."id" AS credential_id
        FROM "projects" p
        INNER JOIN "credentials" c
            ON c."org_id" = p."org_id"
           AND c."env_var_key" = 'GITHUB_REVIEWER_TOKEN'
           AND c."is_default" = true
        WHERE NOT EXISTS (
            SELECT 1 FROM "project_credential_overrides" pco
            WHERE pco."project_id" = p."id"
              AND pco."env_var_key" = 'GITHUB_REVIEWER_TOKEN'
              AND pco."agent_type" IS NULL
        )
    LOOP
        FOREACH agent IN ARRAY reviewer_agents
        LOOP
            INSERT INTO "project_credential_overrides"
                ("project_id", "env_var_key", "credential_id", "agent_type")
            VALUES (r.project_id, 'GITHUB_TOKEN', r.credential_id, agent)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- 5. Remove old GITHUB_REVIEWER_TOKEN project override rows
    DELETE FROM "project_credential_overrides"
    WHERE "env_var_key" = 'GITHUB_REVIEWER_TOKEN'
      AND "agent_type" IS NULL;
END $$;

COMMIT;
