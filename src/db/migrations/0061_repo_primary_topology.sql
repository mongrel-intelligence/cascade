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

-- Belt and braces for deployments bootstrapped via `drizzle-kit push` rather
-- than the journal (see CLAUDE.md's db:bootstrap-journal note): there the old
-- `repo: text('repo').unique()` produced a TABLE-level constraint under
-- drizzle's generated name, which DROP INDEX above does not touch. Left in
-- place it would keep shared repositories impossible on exactly the DBs least
-- likely to be noticed.
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_repo_unique";

-- At most one PRIMARY project per repository. Note "at most", not "exactly":
-- an index cannot require a row to exist, so a repository with only secondaries
-- is not rejected here — save-time validation (plan 4) closes that half.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_projects_repo_primary"
  ON "projects" ("repo")
  WHERE "repo" IS NOT NULL AND "repo_primary";

-- Supports the (repo_full_name, pr_number) link lookup that GitHub routing runs
-- on every webhook (spec 024 plan 4). No existing index leads with
-- repo_full_name, so without this the lookup scans the project-scoped index and
-- filters — on a table that grows with every PR and every work item.
CREATE INDEX IF NOT EXISTS "idx_pr_work_items_repo_pr"
  ON "pr_work_items" ("repo_full_name", "pr_number")
  WHERE "repo_full_name" IS NOT NULL;
