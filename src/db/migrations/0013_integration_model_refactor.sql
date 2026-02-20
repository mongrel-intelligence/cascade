-- 0013_integration_model_refactor.sql
-- Refactor integrations to first-class model with category/provider/triggers,
-- integration_credentials join table, and drop project_credential_overrides.

BEGIN;

-- ============================================================================
-- 1. Add new columns to project_integrations
-- ============================================================================

ALTER TABLE project_integrations
  ADD COLUMN category TEXT,
  ADD COLUMN provider TEXT,
  ADD COLUMN triggers JSONB NOT NULL DEFAULT '{}';

-- ============================================================================
-- 2. Backfill category and provider from type
-- ============================================================================

UPDATE project_integrations
SET provider = type,
    category = CASE
      WHEN type IN ('trello', 'jira') THEN 'pm'
      WHEN type = 'github' THEN 'scm'
    END;

-- ============================================================================
-- 3. Make category and provider NOT NULL
-- ============================================================================

ALTER TABLE project_integrations
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN provider SET NOT NULL;

-- ============================================================================
-- 4. Extract triggers from config JSONB into triggers column
-- ============================================================================

UPDATE project_integrations
SET triggers = COALESCE(config->'triggers', '{}'),
    config = config - 'triggers'
WHERE config ? 'triggers';

-- ============================================================================
-- 5. Drop old unique index and type column
-- ============================================================================

DROP INDEX IF EXISTS uq_project_integrations_project_type;
ALTER TABLE project_integrations DROP COLUMN type;

-- ============================================================================
-- 6. Create new unique index on (project_id, category)
-- ============================================================================

CREATE UNIQUE INDEX uq_project_integrations_project_category
  ON project_integrations (project_id, category);

-- ============================================================================
-- 7. Add CHECK constraint for valid category/provider combinations
-- ============================================================================

ALTER TABLE project_integrations
  ADD CONSTRAINT chk_integration_category_provider
  CHECK (
    (category = 'pm' AND provider IN ('trello', 'jira'))
    OR (category = 'scm' AND provider IN ('github'))
  );

-- ============================================================================
-- 8. Recreate expression indexes for config lookups
-- ============================================================================

CREATE INDEX idx_integrations_trello_board_id
  ON project_integrations ((config->>'boardId'))
  WHERE provider = 'trello';

CREATE INDEX idx_integrations_jira_project_key
  ON project_integrations ((config->>'projectKey'))
  WHERE provider = 'jira';

-- ============================================================================
-- 9. Create integration_credentials table
-- ============================================================================

CREATE TABLE integration_credentials (
  id SERIAL PRIMARY KEY,
  integration_id INTEGER NOT NULL REFERENCES project_integrations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE RESTRICT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_integration_credentials_integration_role UNIQUE (integration_id, role),
  CONSTRAINT chk_integration_credential_role CHECK (
    role IN ('api_key', 'token', 'email', 'api_token', 'implementer_token', 'reviewer_token')
  )
);

CREATE INDEX idx_integration_credentials_credential_id
  ON integration_credentials (credential_id);

-- ============================================================================
-- 10. Migrate GitHub credential references from config JSONB
-- ============================================================================

INSERT INTO integration_credentials (integration_id, role, credential_id)
SELECT pi.id, 'implementer_token', (pi.config->>'implementerCredentialId')::integer
FROM project_integrations pi
WHERE pi.provider = 'github'
  AND pi.config->>'implementerCredentialId' IS NOT NULL
  AND (pi.config->>'implementerCredentialId')::integer IS NOT NULL;

INSERT INTO integration_credentials (integration_id, role, credential_id)
SELECT pi.id, 'reviewer_token', (pi.config->>'reviewerCredentialId')::integer
FROM project_integrations pi
WHERE pi.provider = 'github'
  AND pi.config->>'reviewerCredentialId' IS NOT NULL
  AND (pi.config->>'reviewerCredentialId')::integer IS NOT NULL;

-- ============================================================================
-- 11. Strip implementerCredentialId/reviewerCredentialId from GitHub config
-- ============================================================================

UPDATE project_integrations
SET config = config - 'implementerCredentialId' - 'reviewerCredentialId'
WHERE provider = 'github';

-- ============================================================================
-- 12. Migrate credentials from project_credential_overrides into
--     integration_credentials (PL/pgSQL loop per provider)
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  integration_row RECORD;
  role_name TEXT;
BEGIN
  -- Map env_var_key → (category, role)
  FOR r IN
    SELECT pco.project_id, pco.env_var_key, pco.credential_id
    FROM project_credential_overrides pco
    WHERE pco.agent_type IS NULL  -- project-wide overrides only
  LOOP
    -- Determine category and role from env_var_key
    CASE r.env_var_key
      WHEN 'TRELLO_API_KEY' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'pm' AND provider = 'trello';
        role_name := 'api_key';
      WHEN 'TRELLO_TOKEN' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'pm' AND provider = 'trello';
        role_name := 'token';
      WHEN 'JIRA_EMAIL' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'pm' AND provider = 'jira';
        role_name := 'email';
      WHEN 'JIRA_API_TOKEN' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'pm' AND provider = 'jira';
        role_name := 'api_token';
      WHEN 'GITHUB_TOKEN_IMPLEMENTER' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'scm' AND provider = 'github';
        role_name := 'implementer_token';
      WHEN 'GITHUB_TOKEN_REVIEWER' THEN
        SELECT id INTO integration_row FROM project_integrations
        WHERE project_id = r.project_id AND category = 'scm' AND provider = 'github';
        role_name := 'reviewer_token';
      ELSE
        CONTINUE;  -- Skip non-integration credentials (e.g., LLM API keys)
    END CASE;

    -- Only insert if the integration exists and no duplicate
    IF integration_row.id IS NOT NULL THEN
      INSERT INTO integration_credentials (integration_id, role, credential_id)
      VALUES (integration_row.id, role_name, r.credential_id)
      ON CONFLICT (integration_id, role) DO NOTHING;
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 13. Drop project_credential_overrides table
-- ============================================================================

DROP TABLE IF EXISTS project_credential_overrides;

COMMIT;
