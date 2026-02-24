-- Migration: rename "briefing" agent to "splitting"
-- This is a breaking migration with no backward compatibility.

-- 1. Update agent_configs table
UPDATE agent_configs
SET agent_type = 'splitting'
WHERE agent_type = 'briefing';

-- 2. Update runs table
UPDATE runs
SET agent_type = 'splitting'
WHERE agent_type = 'briefing';

-- 3. Update project_integrations JSONB fields

-- 3a. Trello triggers: cardMovedToBriefing → cardMovedToSplitting
UPDATE project_integrations
SET triggers = triggers - 'cardMovedToBriefing' || jsonb_build_object('cardMovedToSplitting', triggers->'cardMovedToBriefing')
WHERE triggers ? 'cardMovedToBriefing';

-- 3b. JIRA triggers: issueTransitioned.briefing → issueTransitioned.splitting
UPDATE project_integrations
SET triggers = jsonb_set(
    triggers #- '{issueTransitioned,briefing}',
    '{issueTransitioned,splitting}',
    triggers->'issueTransitioned'->'briefing'
)
WHERE triggers->'issueTransitioned' ? 'briefing';

-- 3c. Trello config: lists.briefing → lists.splitting
UPDATE project_integrations
SET config = config - 'lists' || jsonb_build_object(
    'lists',
    (config->'lists') - 'briefing' || jsonb_build_object('splitting', config->'lists'->'briefing')
)
WHERE config->'lists' ? 'briefing';

-- 3d. Trello config: readyToProcessLabel.briefing → readyToProcessLabel.splitting
UPDATE project_integrations
SET triggers = jsonb_set(
    triggers #- '{readyToProcessLabel,briefing}',
    '{readyToProcessLabel,splitting}',
    triggers->'readyToProcessLabel'->'briefing'
)
WHERE triggers->'readyToProcessLabel' ? 'briefing';

-- 3e. JIRA config: statuses.briefing → statuses.splitting
UPDATE project_integrations
SET config = config - 'statuses' || jsonb_build_object(
    'statuses',
    (config->'statuses') - 'briefing' || jsonb_build_object('splitting', config->'statuses'->'briefing')
)
WHERE config->'statuses' ? 'briefing';
