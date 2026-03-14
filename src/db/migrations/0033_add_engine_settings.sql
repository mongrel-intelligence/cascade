ALTER TABLE "cascade_defaults"
ADD COLUMN IF NOT EXISTS "agent_engine_settings" jsonb;

ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "agent_engine_settings" jsonb;
