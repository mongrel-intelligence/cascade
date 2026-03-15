-- Drop legacy org-scoped credential tables.
-- All credentials are now stored in project_credentials (project-scoped).
-- Integration credentials were synced to project_credentials during migration 0040.

DROP TABLE IF EXISTS integration_credentials CASCADE;
DROP TABLE IF EXISTS credentials CASCADE;
