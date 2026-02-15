-- Agent Run Tracking & Debug Analysis Migration
-- Adds tables for tracking agent executions, logs, LLM calls, and debug analyses.

BEGIN;

-- 1. agent_runs — one row per agent execution
CREATE TABLE IF NOT EXISTS "agent_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" text REFERENCES "projects"("id") ON DELETE CASCADE,
    "card_id" text,
    "pr_number" integer,
    "agent_type" text NOT NULL,
    "backend" text NOT NULL,
    "trigger_type" text,
    "status" text NOT NULL DEFAULT 'running',
    "model" text,
    "max_iterations" integer,
    "started_at" timestamp DEFAULT now(),
    "completed_at" timestamp,
    "duration_ms" integer,
    "llm_iterations" integer,
    "gadget_calls" integer,
    "cost_usd" numeric(10, 6),
    "success" boolean,
    "error" text,
    "pr_url" text,
    "output_summary" text
);

CREATE INDEX IF NOT EXISTS "idx_agent_runs_project_id" ON "agent_runs" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_card_id" ON "agent_runs" ("card_id");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_status" ON "agent_runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_started_at" ON "agent_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_project_card" ON "agent_runs" ("project_id", "card_id");

-- 2. agent_run_logs — extracted log text, 1:1 with runs
CREATE TABLE IF NOT EXISTS "agent_run_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL UNIQUE REFERENCES "agent_runs"("id") ON DELETE CASCADE,
    "cascade_log" text,
    "llmist_log" text
);

-- 3. agent_run_llm_calls — individual LLM request/response pairs
CREATE TABLE IF NOT EXISTS "agent_run_llm_calls" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
    "call_number" integer NOT NULL,
    "request" text,
    "response" text,
    "input_tokens" integer,
    "output_tokens" integer,
    "cached_tokens" integer,
    "cost_usd" numeric(10, 6),
    "duration_ms" integer
);

CREATE INDEX IF NOT EXISTS "idx_agent_run_llm_calls_run_call" ON "agent_run_llm_calls" ("run_id", "call_number");

-- 4. debug_analyses — structured debug findings
CREATE TABLE IF NOT EXISTS "debug_analyses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "analyzed_run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
    "debug_run_id" uuid REFERENCES "agent_runs"("id") ON DELETE SET NULL,
    "summary" text NOT NULL,
    "issues" text NOT NULL,
    "timeline" text,
    "recommendations" text,
    "root_cause" text,
    "severity" text
);

CREATE INDEX IF NOT EXISTS "idx_debug_analyses_analyzed_run_id" ON "debug_analyses" ("analyzed_run_id");

COMMIT;
