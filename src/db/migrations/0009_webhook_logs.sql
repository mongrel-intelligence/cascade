CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"headers" jsonb,
	"body" jsonb,
	"body_raw" text,
	"status_code" integer,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text,
	"event_type" text,
	"processed" boolean DEFAULT false NOT NULL
);

CREATE INDEX "idx_webhook_logs_received_at" ON "webhook_logs" ("received_at" DESC);
CREATE INDEX "idx_webhook_logs_source" ON "webhook_logs" ("source");
CREATE INDEX "idx_webhook_logs_source_received_at" ON "webhook_logs" ("source", "received_at" DESC);
