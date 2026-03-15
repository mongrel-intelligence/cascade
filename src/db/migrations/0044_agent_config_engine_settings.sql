-- Add agent_engine_settings JSONB column to agent_configs table.
-- NULL means no per-agent engine settings override (use project-level settings).

ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "agent_engine_settings" jsonb;
