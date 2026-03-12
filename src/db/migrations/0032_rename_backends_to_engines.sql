ALTER TABLE "cascade_defaults" RENAME COLUMN "agent_backend" TO "agent_engine";
ALTER TABLE "projects" RENAME COLUMN "agent_backend" TO "agent_engine";
ALTER TABLE "agent_configs" RENAME COLUMN "agent_backend" TO "agent_engine";
ALTER TABLE "agent_runs" RENAME COLUMN "backend" TO "engine";
ALTER TABLE "agent_run_logs" RENAME COLUMN "llmist_log" TO "engine_log";
