-- Spec 024: allow several projects to share one GitHub repository.
--
-- Until now `repo` carried a plain UNIQUE constraint, so a second project on
-- the same repository could not be saved at all (the attempt surfaced as an
-- unhandled uniqueness violation). Sharing is now expressed as: any number of
-- projects may reference a repository, but exactly ONE of them is the primary.
-- The primary owns every GitHub event that carries no PR->project link
-- (human-authored PRs, freshly opened PRs); linked events route to the project
-- that owns the PR regardless of primacy.
--
-- Forward-compatible by construction: `repo_primary` defaults to true, so every
-- existing row becomes its repository's primary, and because repositories are
-- unique today the new partial index is satisfied without touching any data.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "repo_primary" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "uq_projects_repo";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_projects_repo_primary"
  ON "projects" ("repo")
  WHERE "repo" IS NOT NULL AND "repo_primary";
