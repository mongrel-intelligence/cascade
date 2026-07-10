-- Add review_event_policy TEXT column to agent_configs table.
-- NULL means inherit the default policy (`all`) — the review agent submits
-- real verdicts (APPROVE / REQUEST_CHANGES / COMMENT), the historical behavior.
-- `comment-only` downgrades every review submission to a non-blocking COMMENT
-- with an advisory verdict line so developers keep approval authority.
-- See src/config/reviewEventPolicy.ts for the policy catalog/semantics.

ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "review_event_policy" TEXT;
