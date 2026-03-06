-- Agent Trigger Configs table
-- Stores per-project trigger configurations for agents
CREATE TABLE IF NOT EXISTS agent_trigger_configs (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    parameters JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraint: one config per project/agent/trigger combination
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_trigger_configs_project_agent_event
    ON agent_trigger_configs(project_id, agent_type, trigger_event);

-- Index for efficient lookups by project
CREATE INDEX IF NOT EXISTS idx_agent_trigger_configs_project_id
    ON agent_trigger_configs(project_id);
