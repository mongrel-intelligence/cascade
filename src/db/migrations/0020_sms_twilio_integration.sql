-- 0020_sms_twilio_integration.sql
-- Add Twilio SMS provider support.

BEGIN;

-- ============================================================================
-- 1. Update category/provider CHECK constraint to include sms/twilio
-- ============================================================================

ALTER TABLE project_integrations
  DROP CONSTRAINT IF EXISTS chk_integration_category_provider;

ALTER TABLE project_integrations
  ADD CONSTRAINT chk_integration_category_provider CHECK (
    (category = 'pm'    AND provider IN ('trello', 'jira'))
    OR (category = 'scm'   AND provider IN ('github'))
    OR (category = 'email' AND provider IN ('imap', 'gmail'))
    OR (category = 'sms'   AND provider IN ('twilio'))
  );

-- ============================================================================
-- 2. Update credential role CHECK constraint to include Twilio roles
-- ============================================================================

ALTER TABLE integration_credentials
  DROP CONSTRAINT IF EXISTS chk_integration_credential_role;

ALTER TABLE integration_credentials
  ADD CONSTRAINT chk_integration_credential_role CHECK (
    role IN (
      -- PM roles
      'api_key', 'token', 'email', 'api_token',
      -- SCM roles
      'implementer_token', 'reviewer_token',
      -- Email/IMAP roles
      'imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'username', 'password',
      -- Email/Gmail OAuth roles
      'gmail_email', 'gmail_refresh_token',
      -- SMS/Twilio roles
      'account_sid', 'auth_token', 'phone_number'
    )
  );

COMMIT;
