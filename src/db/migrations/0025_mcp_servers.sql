CREATE TABLE IF NOT EXISTS "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"agent_types" text[],
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "mcp_servers_project_id_name_unique" UNIQUE("project_id","name")
);

ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_project_id_fkey"
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
