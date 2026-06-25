-- Add update_channel TEXT column to agent_configs table.
-- NULL means inherit the default update channel (`both`) — the agent posts
-- communication-only status updates to both PM and SCM surfaces (historical
-- behavior). See src/config/updateChannel.ts for the channel catalog/semantics.

ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "update_channel" TEXT;
