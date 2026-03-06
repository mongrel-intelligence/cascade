-- Migration: Consolidate backend + trailingMessage into unified hooks structure
--
-- This migration is applied via the TypeScript script: tools/migrate-hooks.ts
-- The script transforms JSONB definitions in agent_definitions:
--
-- BEFORE:
--   backend: { hooks: { scm: { enableStopHooks, blockGitPush, requiresPR, ... } } }
--   trailingMessage: { includeDiagnostics, includeTodoProgress, includeGitStatus, includePRStatus, includeReminder }
--
-- AFTER:
--   hooks:
--     trailing: { scm: { gitStatus, prStatus }, builtin: { diagnostics, todoProgress, reminder } }
--     finish: { scm: { requiresPR, requiresReview, requiresPushedChanges, blockGitPush } }
--
-- enableStopHooks is eliminated — having any finish.scm hook implies stop-time checks.
-- blockGitPush moves from backend config to finish.scm behavioral constraint.
--
-- Run: npx tsx tools/migrate-hooks.ts --apply

SELECT 1; -- Marker migration; actual transformation is in tools/migrate-hooks.ts
