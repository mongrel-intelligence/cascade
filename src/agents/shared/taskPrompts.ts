/**
 * Shared task prompt builders used by both backends.
 *
 * The llmist backend (agents/base.ts) and the Claude Code backend
 * (backends/agent-profiles.ts) both need task-level prompts for each agent type.
 * This module is the single source of truth so the two backends produce
 * identical instructions for each agent type.
 */

import { parseRepoFullName } from '../../utils/repo.js';

// ============================================================================
// Work-item agents
// ============================================================================

/**
 * Standard prompt for agents whose primary task is processing a work item
 * (briefing, planning, implementation, debug).
 */
export function buildWorkItemPrompt(cardId: string): string {
	return `Analyze and process the work item with ID: ${cardId}. The work item data has been pre-loaded.`;
}

/**
 * Prompt for agents responding to a PM comment mentioning them.
 */
export function buildCommentResponsePrompt(
	cardId: string,
	commentText: string,
	commentAuthor: string,
): string {
	return `A user (@${commentAuthor}) mentioned you in a comment on work item ${cardId}.

Their comment:
---
${commentText}
---

The work item data (title, description, checklists, attachments, comments) has been pre-loaded above.
Read the user's comment carefully and respond accordingly. Default to surgical, targeted updates unless they clearly ask for a full rewrite.`;
}

// ============================================================================
// PR agents
// ============================================================================

/**
 * Prompt for the review agent.
 */
export function buildReviewPrompt(prNumber: number): string {
	return `Review PR #${prNumber}.

Examine the code changes carefully and submit your review using CreatePRReview.`;
}

/**
 * Prompt for the respond-to-ci agent.
 */
export function buildCIResponsePrompt(prBranch: string, prNumber: number): string {
	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

CI checks have failed. Analyze the failures and fix them.`;
}

/**
 * Prompt for PR-comment-response agents (respond-to-review, respond-to-pr-comment).
 */
export function buildPRCommentResponsePrompt(
	prBranch: string,
	prNumber: number,
	commentBody: string,
	commentPath?: string,
): string {
	const pathContext = commentPath ? `\nFile: ${commentPath}` : '';

	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

A user commented on this PR and mentioned you. Respond to their comment.
${pathContext}

Their comment:
---
${commentBody}
---

Read the comment carefully and respond accordingly. If they ask for code changes, make the changes, commit, and push. If they ask a question, reply with a PR comment. Default to surgical, targeted changes unless they clearly ask for something broader.`;
}

/**
 * Prompt for the respond-to-ci agent (llmist backend format — includes GitHub context).
 * Used by agents/base.ts when the trigger type is 'check-failure'.
 */
export function buildCheckFailurePrompt(prContext: {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
}): string {
	const { owner, repo } = parseRepoFullName(prContext.repoFullName);

	return `You are on branch \`${prContext.prBranch}\` for PR #${prContext.prNumber}.

Your task is to fix the failing checks and push your changes.

## Instructions

1. **Investigate failures**: Use Tmux to run:
   \`gh run list --branch ${prContext.prBranch} --limit 5 --json databaseId,conclusion,status,workflowName\`

2. **Get failure details**: Find failed run ID and run:
   \`gh run view <run-id> --log-failed\`

3. **Analyze error types**:
   - Lint errors: Run \`npm run lint\` or \`pnpm run lint\`
   - Type errors: Run \`npm run typecheck\`
   - Test failures: Run \`npm test\`
   - Build errors: Run \`npm run build\`

4. **Fix issues**: Make targeted fixes following existing codebase patterns

5. **Verify locally**: Run the same checks that failed in CI before pushing

6. **Commit and push**:
   \`\`\`bash
   git add .
   git commit -m "fix: address failing checks"
   git push
   \`\`\`

The push will re-trigger checks automatically.

## GitHub Context
Owner: ${owner}
Repo: ${repo}
PR: #${prContext.prNumber}
Branch: ${prContext.prBranch}`;
}

/**
 * Prompt for the debug agent analyzing session logs.
 */
export function buildDebugPrompt(debugContext: {
	logDir: string;
	originalCardName: string;
	originalCardUrl: string;
	detectedAgentType: string;
}): string {
	return `Analyze the ${debugContext.detectedAgentType} agent session logs in directory: ${debugContext.logDir}

Original card: "${debugContext.originalCardName}"
Link: ${debugContext.originalCardUrl}

Start by listing the contents of the log directory, then read and analyze the logs to identify issues.`;
}
