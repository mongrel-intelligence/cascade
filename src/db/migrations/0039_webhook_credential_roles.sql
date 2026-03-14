-- 0039_webhook_credential_roles.sql
-- Add api_secret (Trello) and webhook_secret (GitHub) credential roles
-- for HMAC webhook signature verification.

BEGIN;

ALTER TABLE integration_credentials
  DROP CONSTRAINT IF EXISTS chk_integration_credential_role;

ALTER TABLE integration_credentials
  ADD CONSTRAINT chk_integration_credential_role CHECK (
    role IN (
      -- PM roles
      'api_key', 'token', 'email', 'api_token',
      -- PM webhook roles
      'api_secret',
      -- SCM roles
      'implementer_token', 'reviewer_token',
      -- SCM webhook roles
      'webhook_secret',
      -- Email/IMAP roles
      'imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'username', 'password',
      -- Email/Gmail OAuth roles
      'gmail_email', 'gmail_refresh_token',
      -- SMS/Twilio roles
      'account_sid', 'auth_token', 'phone_number'
    )
  );

COMMIT;
