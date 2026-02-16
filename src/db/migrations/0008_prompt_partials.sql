-- Prompt partials: store reusable template partials in the database
-- These override the on-disk .eta partial files in src/agents/prompts/templates/partials/

CREATE TABLE prompt_partials (
    id SERIAL PRIMARY KEY,
    org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Global partials (org_id IS NULL): one per name
CREATE UNIQUE INDEX uq_prompt_partials_global
    ON prompt_partials (name)
    WHERE org_id IS NULL;

-- Org-scoped partials: one per (org_id, name)
CREATE UNIQUE INDEX uq_prompt_partials_org
    ON prompt_partials (org_id, name)
    WHERE org_id IS NOT NULL;
