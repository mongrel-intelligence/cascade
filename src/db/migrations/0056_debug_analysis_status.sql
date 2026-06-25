-- Durable, cross-process lifecycle status for debug analyses (MNG-1667).
--
-- The debug_analyses content row is written only at the END of a successful
-- analysis, and the analysis runs inside a separate worker container, so neither
-- that row nor the dashboard BullMQ job (which reaches `completed` at container
-- spawn, not at analysis completion) can represent an in-progress analysis. This
-- table is the worker-owned signal: 'running' while the debug agent executes,
-- 'failed' on error; the row is removed on success, after which a present
-- debug_analyses row is the 'completed' signal. updated_at lets readers treat a
-- 'running' row left behind by a crashed worker as stale.
CREATE TABLE IF NOT EXISTS "debug_analysis_status" (
    "analyzed_run_id" uuid PRIMARY KEY REFERENCES "agent_runs"("id") ON DELETE CASCADE,
    "status" text NOT NULL,
    "updated_at" timestamp NOT NULL DEFAULT now()
);
