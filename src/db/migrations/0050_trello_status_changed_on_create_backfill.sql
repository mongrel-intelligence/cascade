-- 0050_trello_status_changed_on_create_backfill.sql
-- Backfill onCreate/onMove defaults for existing Trello projects so their
-- pm:status-changed triggers preserve the pre-feature behavior (fire on both
-- createCard and updateCard). YAML defaults are onCreate=false/onMove=true,
-- which would regress existing Trello users; this migration makes each Trello
-- project's intent explicit in the DB.
--
-- Idempotent: re-running is a no-op because '||' lets the right-hand side
-- (the existing parameters) win on key overlap.

BEGIN;

UPDATE agent_trigger_configs atc
SET parameters = '{"onCreate": true, "onMove": true}'::jsonb || COALESCE(atc.parameters, '{}'::jsonb)
WHERE atc.trigger_event = 'pm:status-changed'
  AND EXISTS (
    SELECT 1
    FROM project_integrations pi
    WHERE pi.project_id = atc.project_id
      AND pi.category   = 'pm'
      AND pi.provider   = 'trello'
  );

COMMIT;
