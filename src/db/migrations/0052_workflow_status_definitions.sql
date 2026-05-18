CREATE TABLE workflow_status_definitions (
  id SERIAL PRIMARY KEY,
  status_key TEXT NOT NULL,
  label TEXT NOT NULL,
  agent_type TEXT,
  sort_order INT NOT NULL DEFAULT 1000,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_status_definitions_status_key UNIQUE (status_key)
);

