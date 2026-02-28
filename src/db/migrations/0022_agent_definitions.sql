CREATE TABLE agent_definitions (
  id SERIAL PRIMARY KEY,
  agent_type TEXT NOT NULL,
  definition JSONB NOT NULL,
  is_builtin BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_definitions_agent_type UNIQUE (agent_type)
);
