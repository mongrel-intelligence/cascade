-- Add system_prompt and task_prompt TEXT columns to agent_configs table.
-- NULL means no per-agent prompt override (use the agent's built-in defaults).

ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "system_prompt" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "task_prompt" TEXT;
