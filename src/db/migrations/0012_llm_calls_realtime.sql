ALTER TABLE "agent_run_llm_calls" ADD COLUMN "model" text;
ALTER TABLE "agent_run_llm_calls" ADD COLUMN "created_at" timestamp DEFAULT now();
