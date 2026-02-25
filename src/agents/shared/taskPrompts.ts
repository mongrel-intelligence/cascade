/**
 * Shared task prompt builders for prompts NOT managed via the YAML profile system.
 *
 * Task prompts managed through YAML profiles (workItem, commentResponse, review,
 * ci, prCommentResponse) are now .eta templates in `src/agents/prompts/task-templates/`
 * rendered via `renderTaskPrompt()` in the profile builder.
 *
 * This module retains only the two prompts called directly by trigger handlers/agents,
 * not through the profile system: `buildCheckFailurePrompt` and `buildDebugPrompt`.
 */

import { parseRepoFullName } from '../../utils/repo.js';

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
