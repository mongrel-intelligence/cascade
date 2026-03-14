ALTER TABLE agent_configs ADD COLUMN max_concurrency INTEGER CHECK (max_concurrency IS NULL OR max_concurrency > 0);
