-- Organizations and Credentials Migration
-- Introduces organizations as top-level entity, org-scoped credentials,
-- and project credential overrides (replacing flat project_secrets).

BEGIN;

-- 1. Create organizations table
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- 2. Insert default organization
INSERT INTO "organizations" ("id", "name")
VALUES ('default', 'Default Organization')
ON CONFLICT ("id") DO NOTHING;

-- 3. Add org_id to projects (nullable first, backfill, then NOT NULL)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "org_id" text;
UPDATE "projects" SET "org_id" = 'default' WHERE "org_id" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;

-- 4. Add org_id to cascade_defaults (nullable first, backfill, then NOT NULL + UNIQUE)
ALTER TABLE "cascade_defaults" ADD COLUMN IF NOT EXISTS "org_id" text;
UPDATE "cascade_defaults" SET "org_id" = 'default' WHERE "org_id" IS NULL;
ALTER TABLE "cascade_defaults" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "cascade_defaults" ADD CONSTRAINT "cascade_defaults_org_id_organizations_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cascade_defaults" ADD CONSTRAINT "cascade_defaults_org_id_unique" UNIQUE ("org_id");

-- 5. Add org_id to agent_configs (nullable FK, backfill global configs)
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "org_id" text;
UPDATE "agent_configs" SET "org_id" = 'default' WHERE "project_id" IS NULL AND "org_id" IS NULL;
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_org_id_organizations_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;

-- 6. Create credentials table
CREATE TABLE IF NOT EXISTS "credentials" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL,
    "name" text NOT NULL,
    "env_var_key" text NOT NULL,
    "value" text NOT NULL,
    "description" text,
    "is_default" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "credentials_org_id_organizations_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_credentials_org_env_var_key"
    ON "credentials" ("org_id", "env_var_key");

-- Partial unique: enforce at most one default per (org_id, env_var_key)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_credentials_org_env_var_key_default"
    ON "credentials" ("org_id", "env_var_key") WHERE "is_default" = true;

-- 7. Create project_credential_overrides table
CREATE TABLE IF NOT EXISTS "project_credential_overrides" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" text NOT NULL,
    "env_var_key" text NOT NULL,
    "credential_id" integer NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "project_credential_overrides_project_id_projects_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "project_credential_overrides_credential_id_credentials_id_fk"
        FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_credential_overrides_project_env_var_key"
    ON "project_credential_overrides" ("project_id", "env_var_key");

-- 8. Migrate data from project_secrets → credentials + overrides
-- For each unique (key, value) pair, create one credential in 'default' org.
-- Use a temp table to track the mapping.
DO $$
DECLARE
    r RECORD;
    cred_id integer;
    first_for_key boolean;
BEGIN
    -- Track which env_var_keys we've already seen (to mark first as default)
    CREATE TEMP TABLE IF NOT EXISTS _seen_keys (env_var_key text PRIMARY KEY);

    FOR r IN
        SELECT DISTINCT ps."key" AS env_var_key, ps."value" AS secret_value
        FROM "project_secrets" ps
        ORDER BY ps."key", ps."value"
    LOOP
        -- Check if this is the first credential for this env_var_key
        first_for_key := NOT EXISTS (SELECT 1 FROM _seen_keys WHERE env_var_key = r.env_var_key);

        INSERT INTO "credentials" ("org_id", "name", "env_var_key", "value", "is_default")
        VALUES ('default', r.env_var_key, r.env_var_key, r.secret_value, first_for_key)
        RETURNING "id" INTO cred_id;

        IF first_for_key THEN
            INSERT INTO _seen_keys VALUES (r.env_var_key);
        END IF;

        -- For every project that had this exact (key, value), if it's the default,
        -- no override needed. If it's not the default, create an override.
        IF NOT first_for_key THEN
            INSERT INTO "project_credential_overrides" ("project_id", "env_var_key", "credential_id")
            SELECT ps."project_id", ps."key", cred_id
            FROM "project_secrets" ps
            WHERE ps."key" = r.env_var_key AND ps."value" = r.secret_value
            ON CONFLICT ("project_id", "env_var_key") DO NOTHING;
        END IF;
    END LOOP;

    DROP TABLE IF EXISTS _seen_keys;
END $$;

-- 9. project_secrets is kept alive for now (will be dropped in 0004 after verification)

COMMIT;
