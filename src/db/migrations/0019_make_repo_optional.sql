-- Make repo column optional to support email-only projects
ALTER TABLE projects ALTER COLUMN repo DROP NOT NULL;

-- Drop the existing unique index and recreate it as a partial index
-- (only enforces uniqueness for non-null values)
DROP INDEX IF EXISTS uq_projects_repo;
CREATE UNIQUE INDEX uq_projects_repo ON projects (repo) WHERE repo IS NOT NULL;
