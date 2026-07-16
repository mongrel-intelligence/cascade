-- 0061_allow_github_projects_pm_provider.sql
-- Add github-projects to the allowed pm providers in the integration category/provider CHECK constraint.

BEGIN;

ALTER TABLE project_integrations
  DROP CONSTRAINT IF EXISTS chk_integration_category_provider;

ALTER TABLE project_integrations
  ADD CONSTRAINT chk_integration_category_provider CHECK (
    (category = 'pm'       AND provider IN ('trello', 'jira', 'linear', 'github-projects'))
    OR (category = 'scm'   AND provider IN ('github'))
    OR (category = 'email' AND provider IN ('imap', 'gmail'))
    OR (category = 'sms'   AND provider IN ('twilio'))
    OR (category = 'alerting' AND provider IN ('sentry'))
  );

COMMIT;
