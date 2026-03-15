-- 0040_project_scoped_credentials.sql
-- Create project_credentials table and backfill from org-scoped + integration credentials.
--
-- NOTE ON ENCRYPTION:
-- Values copied here retain their original encryption AAD (orgId). When
-- CREDENTIAL_MASTER_KEY is set, run the re-encryption tool after this migration:
--   npx tsx tools/migrate-project-credentials-reencrypt.ts
-- This will decrypt each value with its org's orgId and re-encrypt with the projectId.

BEGIN;

-- Step 1: Create the project_credentials table
CREATE TABLE IF NOT EXISTS project_credentials (
  id           SERIAL PRIMARY KEY,
  project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  env_var_key  TEXT    NOT NULL,
  value        TEXT    NOT NULL,
  name         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Unique constraint on (project_id, env_var_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_credentials_project_env_var_key
  ON project_credentials(project_id, env_var_key);

-- Step 3: Backfill org-default credentials into every project in the org.
-- Only the is_default=true credentials are treated as org defaults.
-- ON CONFLICT DO NOTHING means integration credentials added in Step 4 won't
-- be overwritten here; we rely on Step 4's ON CONFLICT DO UPDATE to apply
-- integration overrides after the defaults have been inserted.
INSERT INTO project_credentials (project_id, env_var_key, value, name, created_at, updated_at)
SELECT
  p.id          AS project_id,
  c.env_var_key,
  c.value,
  c.name,
  NOW()         AS created_at,
  NOW()         AS updated_at
FROM credentials c
JOIN projects p ON p.org_id = c.org_id
WHERE c.is_default = true
ON CONFLICT (project_id, env_var_key) DO NOTHING;

-- Step 4: Backfill integration credentials, overriding org defaults when both
-- exist for the same (project_id, env_var_key).
-- The role→env_var_key mapping mirrors PROVIDER_CREDENTIAL_ROLES in
-- src/config/integrationRoles.ts:
--   trello:  api_key → TRELLO_API_KEY
--            api_secret → TRELLO_API_SECRET
--            token → TRELLO_TOKEN
--   jira:    email → JIRA_EMAIL
--            api_token → JIRA_API_TOKEN
--   github:  implementer_token → GITHUB_TOKEN_IMPLEMENTER
--            reviewer_token → GITHUB_TOKEN_REVIEWER
--            webhook_secret → GITHUB_WEBHOOK_SECRET
INSERT INTO project_credentials (project_id, env_var_key, value, name, created_at, updated_at)
SELECT
  pi.project_id,
  CASE ic.role
    WHEN 'api_key'           THEN 'TRELLO_API_KEY'
    WHEN 'api_secret'        THEN 'TRELLO_API_SECRET'
    WHEN 'token'             THEN 'TRELLO_TOKEN'
    WHEN 'email'             THEN 'JIRA_EMAIL'
    WHEN 'api_token'         THEN 'JIRA_API_TOKEN'
    WHEN 'implementer_token' THEN 'GITHUB_TOKEN_IMPLEMENTER'
    WHEN 'reviewer_token'    THEN 'GITHUB_TOKEN_REVIEWER'
    WHEN 'webhook_secret'    THEN 'GITHUB_WEBHOOK_SECRET'
    ELSE ic.role
  END                        AS env_var_key,
  c.value,
  c.name,
  NOW()                      AS created_at,
  NOW()                      AS updated_at
FROM integration_credentials ic
JOIN project_integrations pi ON pi.id = ic.integration_id
JOIN credentials c ON c.id = ic.credential_id
-- Only process roles that have a known env_var_key mapping
WHERE ic.role IN (
  'api_key', 'api_secret', 'token',
  'email', 'api_token',
  'implementer_token', 'reviewer_token', 'webhook_secret'
)
ON CONFLICT (project_id, env_var_key) DO UPDATE
  SET value      = EXCLUDED.value,
      name       = EXCLUDED.name,
      updated_at = NOW();

COMMIT;
