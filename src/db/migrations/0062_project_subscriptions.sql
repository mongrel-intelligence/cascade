-- Multiple Claude Code OAuth tokens ("subscriptions") per project, with usage tracking
-- for selection and rate-limit failover. `value` is encrypted like project_credentials.
CREATE TABLE IF NOT EXISTS "project_subscriptions" (
  "id" SERIAL PRIMARY KEY,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "five_hour_pct" INTEGER NOT NULL DEFAULT 0 CHECK ("five_hour_pct" BETWEEN 0 AND 100),
  "five_hour_reset_at" TIMESTAMPTZ,
  "seven_day_pct" INTEGER NOT NULL DEFAULT 0 CHECK ("seven_day_pct" BETWEEN 0 AND 100),
  "seven_day_reset_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_subscriptions_project_name"
  ON "project_subscriptions" ("project_id", "name");

CREATE INDEX IF NOT EXISTS "idx_project_subscriptions_project_enabled"
  ON "project_subscriptions" ("project_id") WHERE "enabled" = true;
