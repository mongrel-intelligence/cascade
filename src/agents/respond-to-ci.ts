import { formatCheckStatus } from '../gadgets/github/core/getPRChecks.js';
import type { CheckSuiteStatus } from '../github/client.js';
import { githubClient } from '../github/client.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { runCommand as execCommand } from '../utils/repo.js';
import { createPRAgentGadgets } from './shared/gadgets.js';
import {
	type GitHubAgentContext,
	type GitHubAgentDefinition,
	type GitHubAgentInput,
	type RepoIdentifier,
	createInitialPRComment,
	executeGitHubAgent,
} from './shared/githubAgent.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { formatPRDetails, formatPRDiff } from './shared/prFormatting.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';

interface RespondToCIAgentInput extends GitHubAgentInput {
	headSha: string;
}

// ============================================================================
// CI Log Fetching
// ============================================================================

interface WorkflowRun {
	databaseId: number;
	name: string;
	conclusion: string;
	headSha: string;
}

function truncateLogOutput(stdout: string, maxLines = 200): string {
	const logLines = stdout.split('\n');
	if (logLines.length <= maxLines) {
		return stdout;
	}
	const truncatedCount = logLines.length - maxLines;
	return `[... truncated ${truncatedCount} lines ...]\n${logLines.slice(-maxLines).join('\n')}`;
}

function formatCheckLogEntry(checkName: string, content: string, isCode = false): string {
	if (isCode) {
		return `## ${checkName}\n\n\`\`\`\n${content}\n\`\`\``;
	}
	return `## ${checkName}\n\n${content}`;
}

async function fetchSingleRunLog(
	runId: number,
	owner: string,
	repo: string,
	repoDir: string,
): Promise<{ success: boolean; content: string }> {
	const logResult = await execCommand(
		'gh',
		['run', 'view', String(runId), '--repo', `${owner}/${repo}`, '--log-failed'],
		repoDir,
	);

	if (logResult.exitCode === 0 && logResult.stdout.trim()) {
		return { success: true, content: truncateLogOutput(logResult.stdout) };
	}
	return { success: false, content: logResult.stderr || 'No output' };
}

async function fetchFailedCheckLogs(
	owner: string,
	repo: string,
	checkStatus: CheckSuiteStatus,
	repoDir: string,
	log: {
		info: (msg: string, ctx?: Record<string, unknown>) => void;
		warn: (msg: string, ctx?: Record<string, unknown>) => void;
	},
): Promise<string> {
	const failedRuns = checkStatus.checkRuns.filter(
		(cr) =>
			cr.conclusion === 'failure' ||
			cr.conclusion === 'timed_out' ||
			cr.conclusion === 'action_required',
	);

	if (failedRuns.length === 0) {
		return 'No failed check logs to display.';
	}

	log.info('Fetching failed check logs via gh CLI', { failedCount: failedRuns.length });

	const listResult = await execCommand(
		'gh',
		[
			'run',
			'list',
			'--repo',
			`${owner}/${repo}`,
			'--limit',
			'20',
			'--json',
			'databaseId,name,conclusion,headSha',
		],
		repoDir,
	);

	if (listResult.exitCode !== 0) {
		log.warn('Failed to list workflow runs', { stderr: listResult.stderr });
		return `Unable to fetch check logs: ${listResult.stderr}`;
	}

	const runs = JSON.parse(listResult.stdout) as WorkflowRun[];
	const logs: string[] = [];

	for (const failedCheck of failedRuns) {
		const logEntry = await processFailedCheck(failedCheck, runs, owner, repo, repoDir, log);
		logs.push(logEntry);
	}

	return logs.length > 0 ? logs.join('\n\n---\n\n') : 'No failed check logs available.';
}

async function processFailedCheck(
	failedCheck: { name: string; conclusion: string | null },
	runs: WorkflowRun[],
	owner: string,
	repo: string,
	repoDir: string,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
): Promise<string> {
	const matchingRun = runs.find(
		(r) =>
			r.name === failedCheck.name && (r.conclusion === 'failure' || r.conclusion === 'timed_out'),
	);

	if (!matchingRun) {
		return formatCheckLogEntry(
			failedCheck.name,
			'No matching workflow run found for log retrieval.',
		);
	}

	log.info('Fetching logs for failed run', {
		name: matchingRun.name,
		id: matchingRun.databaseId,
	});

	const result = await fetchSingleRunLog(matchingRun.databaseId, owner, repo, repoDir);

	if (result.success) {
		return formatCheckLogEntry(failedCheck.name, result.content, true);
	}
	return formatCheckLogEntry(failedCheck.name, `Unable to fetch logs: ${result.content}`);
}

// ============================================================================
// Context Building
// ============================================================================

interface CIContextData extends GitHubAgentContext {
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	diffFormatted: string;
	checkStatusFormatted: string;
	failedLogsFormatted: string;
}

async function buildCIContext(
	owner: string,
	repo: string,
	prNumber: number,
	prBranch: string,
	headSha: string,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: {
		info: (msg: string, ctx?: Record<string, unknown>) => void;
		warn: (msg: string, ctx?: Record<string, unknown>) => void;
	},
	modelOverride?: string,
): Promise<CIContextData> {
	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType: 'respond-to-ci',
		project,
		config,
		repoDir,
		modelOverride,
	});

	// Fetch PR details and diff
	log.info('Fetching PR details and diff', { owner, repo, prNumber });
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prDiff = await githubClient.getPRDiff(owner, repo, prNumber);

	// Get check suite status
	log.info('Fetching check suite status', { owner, repo, headSha });
	const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);

	// Fetch failed check logs
	const failedLogsFormatted = await fetchFailedCheckLogs(owner, repo, checkStatus, repoDir, log);

	// Format data
	const prDetailsFormatted = formatPRDetails(prDetails);
	const diffFormatted = formatPRDiff(prDiff);
	const checkStatusFormatted = formatCheckStatus(prNumber, checkStatus);

	// Build prompt
	const prompt = buildCIPrompt(prBranch, prNumber, owner, repo);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		prDetailsFormatted,
		diffFormatted,
		checkStatusFormatted,
		failedLogsFormatted,
		prompt,
	};
}

function buildCIPrompt(prBranch: string, prNumber: number, owner: string, repo: string): string {
	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

CI checks have failed. Analyze the failures and fix them.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (GetPRDetails, PostPRComment, UpdatePRComment).`;
}

// ============================================================================
// Agent Definition
// ============================================================================

const ciAgentDefinition: GitHubAgentDefinition<RespondToCIAgentInput, CIContextData> = {
	agentType: 'respond-to-ci',
	initialCommentDescription: 'Acknowledge CI failures',
	timeoutMessage: '⚠️ CI fix agent timed out while attempting to fix failures.',
	loggerPrefix: 'ci',

	getGadgets: () => createPRAgentGadgets(),

	async preExecute(input: RespondToCIAgentInput, id: RepoIdentifier) {
		const checkStatus = await githubClient.getCheckSuiteStatus(id.owner, id.repo, input.headSha);
		const hasFailedChecks = checkStatus.checkRuns.some(
			(cr) =>
				cr.conclusion === 'failure' ||
				cr.conclusion === 'timed_out' ||
				cr.conclusion === 'action_required',
		);

		if (!hasFailedChecks) {
			logger.info('No failed checks found, skipping CI fix agent', {
				prNumber: input.prNumber,
				headSha: input.headSha,
				totalChecks: checkStatus.totalCount,
			});
			return { success: true, output: 'No failed checks to fix' };
		}
		return null;
	},

	postInitialComment: (input, id, headerMessage) =>
		createInitialPRComment(input.prNumber, id, headerMessage),

	buildContext: ({ owner, repo }, input, repoDir, log) =>
		buildCIContext(
			owner,
			repo,
			input.prNumber,
			input.prBranch,
			input.headSha,
			repoDir,
			input.project,
			input.config,
			log,
			input.modelOverride,
		),

	async injectSyntheticCalls({
		builder,
		ctx,
		trackingContext,
		repoDir,
		id: { owner, repo },
		input,
	}) {
		let b = injectDirectoryListing(builder, trackingContext);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRDetails',
			{ comment: 'Pre-fetching PR details for context', owner, repo, prNumber: input.prNumber },
			ctx.prDetailsFormatted,
			'gc_pr_details',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRDiff',
			{ comment: 'Pre-fetching PR diff for context', owner, repo, prNumber: input.prNumber },
			ctx.diffFormatted,
			'gc_pr_diff',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetCheckStatus',
			{ comment: 'Pre-fetching CI check status', owner, repo, prNumber: input.prNumber },
			ctx.checkStatusFormatted,
			'gc_check_status',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetFailedCheckLogs',
			{ comment: 'Pre-fetching failed CI check logs', owner, repo, prNumber: input.prNumber },
			ctx.failedLogsFormatted,
			'gc_failed_logs',
		);

		b = injectContextFiles(b, trackingContext, ctx.contextFiles);
		b = injectSquintContext(b, trackingContext, repoDir);

		return b;
	},
};

// ============================================================================
// CI Agent Execution
// ============================================================================

export async function executeRespondToCIAgent(input: RespondToCIAgentInput): Promise<AgentResult> {
	return executeGitHubAgent(ciAgentDefinition, input);
}
