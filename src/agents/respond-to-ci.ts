import type { createLogger } from 'llmist';
import { WriteFile } from '../gadgets/WriteFile.js';

import { AstGrep } from '../gadgets/AstGrep.js';
import { FileSearchAndReplace } from '../gadgets/FileSearchAndReplace.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { RipGrep } from '../gadgets/RipGrep.js';
import { Sleep } from '../gadgets/Sleep.js';
import {
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	UpdatePRComment,
} from '../gadgets/github/index.js';
import { recordInitialComment } from '../gadgets/sessionState.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import type { CheckSuiteStatus } from '../github/client.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { runCommand as execCommand } from '../utils/repo.js';
import { type BuilderType, createConfiguredBuilder } from './shared/builderFactory.js';
import { executeAgentLifecycle } from './shared/lifecycle.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { formatPRDetails, formatPRDiff } from './shared/prFormatting.js';
import { setupRepository } from './shared/repository.js';
import {
	injectAUContext,
	injectContextFiles,
	injectDirectoryListing,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';
import type { TrackingContext } from './utils/tracking.js';

interface RespondToCIAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

// ============================================================================
// CI Data Formatting
// ============================================================================

function formatCheckStatus(checkStatus: CheckSuiteStatus): string {
	const lines = ['## Check Suite Status', `Total checks: ${checkStatus.totalCount}`, ''];

	// Group by status/conclusion
	const passed = checkStatus.checkRuns.filter(
		(cr) =>
			cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral',
	);
	const failed = checkStatus.checkRuns.filter(
		(cr) =>
			cr.conclusion === 'failure' ||
			cr.conclusion === 'timed_out' ||
			cr.conclusion === 'action_required',
	);
	const pending = checkStatus.checkRuns.filter((cr) => cr.status !== 'completed');

	if (failed.length > 0) {
		lines.push('### Failed Checks');
		for (const cr of failed) {
			lines.push(`- **${cr.name}**: ${cr.conclusion}`);
		}
		lines.push('');
	}

	if (passed.length > 0) {
		lines.push('### Passed Checks');
		for (const cr of passed) {
			lines.push(`- ${cr.name}: ${cr.conclusion}`);
		}
		lines.push('');
	}

	if (pending.length > 0) {
		lines.push('### Pending Checks');
		for (const cr of pending) {
			lines.push(`- ${cr.name}: ${cr.status}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

// ============================================================================
// Context Building
// ============================================================================

interface CIContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	diffFormatted: string;
	checkStatusFormatted: string;
	failedLogsFormatted: string;
	prompt: string;
}

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
	const checkStatusFormatted = formatCheckStatus(checkStatus);

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
// Agent Builder
// ============================================================================

function getCIGadgets() {
	return [
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new WriteFile(),
		new RipGrep(),
		new AstGrep(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new PostPRComment(),
		new UpdatePRComment(),
		new Finish(),
	];
}

function createRespondToCIAgentBuilder(
	client: import('llmist').LLMist,
	ctx: CIContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	return createConfiguredBuilder({
		client,
		agentType: 'respond-to-ci',
		model: ctx.model,
		systemPrompt: ctx.systemPrompt,
		maxIterations: ctx.maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		repoDir,
		gadgets: getCIGadgets(),
	});
}

async function injectCISyntheticCalls(
	initialBuilder: BuilderType,
	owner: string,
	repo: string,
	prNumber: number,
	ctx: CIContextData,
	trackingContext: TrackingContext,
	repoDir: string,
	initialCommentId: number,
	initialCommentUrl: string,
): Promise<BuilderType> {
	// Record the acknowledgment comment as synthetic call (already posted earlier)
	let builder = injectSyntheticCall(
		initialBuilder,
		trackingContext,
		'PostPRComment',
		{
			comment: 'Acknowledge CI failures',
			owner,
			repo,
			prNumber,
			body: '🤖 Working on fixing CI failures...',
		},
		`Comment posted (id: ${initialCommentId}): ${initialCommentUrl}`,
		'gc_initial_comment',
	);

	builder = injectDirectoryListing(builder, trackingContext);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRDetails',
		{ comment: 'Pre-fetching PR details for context', owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRDiff',
		{ comment: 'Pre-fetching PR diff for context', owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetCheckStatus',
		{ comment: 'Pre-fetching CI check status', owner, repo, prNumber },
		ctx.checkStatusFormatted,
		'gc_check_status',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetFailedCheckLogs',
		{ comment: 'Pre-fetching failed CI check logs', owner, repo, prNumber },
		ctx.failedLogsFormatted,
		'gc_failed_logs',
	);

	builder = injectContextFiles(builder, trackingContext, ctx.contextFiles);
	builder = await injectAUContext(builder, trackingContext, repoDir);

	return builder;
}

// ============================================================================
// CI Agent Execution
// ============================================================================

export async function executeRespondToCIAgent(input: RespondToCIAgentInput): Promise<AgentResult> {
	const { project, config, prNumber, prBranch, repoFullName, headSha, interactive, autoAccept } =
		input;

	// Parse owner/repo from repoFullName
	const [owner, repo] = repoFullName.split('/');
	if (!owner || !repo) {
		return { success: false, output: '', error: `Invalid repo format: ${repoFullName}` };
	}

	// Verify there are actually failed checks before proceeding
	const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
	const hasFailedChecks = checkStatus.checkRuns.some(
		(cr) =>
			cr.conclusion === 'failure' ||
			cr.conclusion === 'timed_out' ||
			cr.conclusion === 'action_required',
	);

	if (!hasFailedChecks) {
		logger.info('No failed checks found, skipping CI fix agent', {
			prNumber,
			headSha,
			totalChecks: checkStatus.totalCount,
		});
		return { success: true, output: 'No failed checks to fix' };
	}

	// Post acknowledgment comment immediately so user knows we're working on it
	const initialCommentBody = '🤖 Working on fixing CI failures...';
	const initialComment = await githubClient.createPRComment(
		owner,
		repo,
		prNumber,
		initialCommentBody,
	);
	recordInitialComment(initialComment.id);
	logger.info('Posted initial acknowledgment comment', { prNumber, commentId: initialComment.id });

	return executeAgentLifecycle<CIContextData>({
		loggerIdentifier: `ci-${prNumber}`,

		onWatchdogTimeout: async () => {
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ CI fix agent timed out while attempting to fix failures.',
			);
			logger.info('Posted timeout notice to PR', { prNumber });
		},

		setupRepoDir: (log) => setupRepository({ project, log, agentType: 'respond-to-ci', prBranch }),

		buildContext: (repoDir, log) =>
			buildCIContext(
				owner,
				repo,
				prNumber,
				prBranch,
				headSha,
				repoDir,
				project,
				config,
				log,
				input.modelOverride,
			),

		createBuilder: ({ client, ctx, llmistLogger, trackingContext, fileLogger, repoDir }) =>
			createRespondToCIAgentBuilder(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
			),

		injectSyntheticCalls: ({ builder, ctx, trackingContext, repoDir }) =>
			injectCISyntheticCalls(
				builder,
				owner,
				repo,
				prNumber,
				ctx,
				trackingContext,
				repoDir,
				initialComment.id,
				initialComment.htmlUrl,
			),

		interactive,
		autoAccept,
	});
}
