-- 0047_add_alerting_integration.sql
-- Add alerting/sentry provider to the integration category/provider CHECK constraint.

BEGIN;

ALTER TABLE project_integrations
  DROP CONSTRAINT IF EXISTS chk_integration_category_provider;

ALTER TABLE project_integrations
  ADD CONSTRAINT chk_integration_category_provider CHECK (
    (category = 'pm'       AND provider IN ('trello', 'jira'))
    OR (category = 'scm'   AND provider IN ('github'))
    OR (category = 'email' AND provider IN ('imap', 'gmail'))
    OR (category = 'sms'   AND provider IN ('twilio'))
    OR (category = 'alerting' AND provider IN ('sentry'))
  );

COMMIT;
