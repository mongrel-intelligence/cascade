-- Remove 'stories' key from Trello lists config and JIRA statuses config
-- in project_integrations JSONB. Trello lists/JIRA statuses themselves are NOT deleted.

UPDATE project_integrations
SET config = config #- '{lists,stories}'
WHERE config->'lists' ? 'stories';

UPDATE project_integrations
SET config = config #- '{statuses,stories}'
WHERE config->'statuses' ? 'stories';
