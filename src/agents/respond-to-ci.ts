import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { auList, auRead } from '@zbigniewsobiecki/au';
import { AgentBuilder, LLMist, createLogger } from 'llmist';
import { WriteFile } from '../gadgets/WriteFile.js';

import { getCompactionConfig } from '../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../config/hintConfig.js';
import { getRateLimitForModel } from '../config/rateLimits.js';
import { getRetryConfig } from '../config/retryConfig.js';
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
import { initSessionState, recordInitialComment } from '../gadgets/sessionState.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import type { CheckSuiteStatus } from '../github/client.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';
import { runAgentLoop } from './utils/agentLoop.js';
import { createObserverHooks } from './utils/hooks.js';
import { getLogLevel, readContextFiles } from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';
import {
	type TrackingContext,
	createTrackingContext,
	recordSyntheticInvocationId,
} from './utils/tracking.js';

interface RespondToCIAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

// ============================================================================
// Repository Setup
// ============================================================================

async function setupRepository(
	project: ProjectConfig,
	prBranch: string,
	log: ReturnType<typeof createAgentLogger>,
): Promise<string> {
	// Clone repo to temp directory
	const repoDir = createTempDir(project.id);
	cloneRepo(project, repoDir);

	// Checkout the PR branch
	log.info('Checking out PR branch', { prBranch });
	await execCommand('git', ['checkout', prBranch], repoDir);

	// Run project-specific setup script if it exists (handles dependency installation)
	const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
	if (existsSync(setupScriptPath)) {
		log.info('Running project setup script', {
			path: '.cascade/setup.sh',
			agentType: 'respond-to-ci',
		});
		const setupResult = await execCommand('bash', [setupScriptPath], repoDir, {
			AGENT_PROFILE_NAME: 'respond-to-ci',
		});
		log.info('Setup script completed', {
			exitCode: setupResult.exitCode,
			stdout: setupResult.stdout.slice(-500),
			stderr: setupResult.stderr.slice(-500),
		});
		if (setupResult.exitCode !== 0) {
			log.warn('Setup script exited with non-zero code', { exitCode: setupResult.exitCode });
		}
	}

	return repoDir;
}

// ============================================================================
// CI Data Formatting
// ============================================================================

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRDiff = Awaited<ReturnType<typeof githubClient.getPRDiff>>;

function formatPRDetails(prDetails: PRDetails): string {
	return [
		`PR #${prDetails.number}: ${prDetails.title}`,
		`State: ${prDetails.state}`,
		`Branch: ${prDetails.headRef} -> ${prDetails.baseRef}`,
		`URL: ${prDetails.htmlUrl}`,
		'',
		'Description:',
		prDetails.body || '(no description)',
	].join('\n');
}

function formatPRDiff(prDiff: PRDiff): string {
	if (prDiff.length === 0) {
		return 'No files changed in this PR.';
	}

	const formatted = prDiff.map((f) => {
		const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
		if (f.patch) {
			lines.push('```diff', f.patch, '```');
		} else {
			lines.push('[Binary file or too large to display]');
		}
		return lines.join('\n');
	});

	return `${prDiff.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
}

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
	contextFiles: Awaited<ReturnType<typeof readContextFiles>>;
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
	log: ReturnType<typeof createAgentLogger>,
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
	log: ReturnType<typeof createAgentLogger>,
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
	log: ReturnType<typeof createAgentLogger>,
	modelOverride?: string,
): Promise<CIContextData> {
	// Get system prompt and model
	const systemPrompt = project.prompts?.['respond-to-ci'] || getSystemPrompt('respond-to-ci', {});
	const model =
		modelOverride ||
		project.agentModels?.['respond-to-ci'] ||
		project.model ||
		config.defaults.agentModels?.['respond-to-ci'] ||
		config.defaults.model;
	const maxIterations =
		config.defaults.agentIterations?.['respond-to-ci'] || config.defaults.maxIterations;

	// Read context files
	const contextFiles = await readContextFiles(repoDir);

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

type BuilderType = ReturnType<typeof AgentBuilder.prototype.withGadgets>;

function createRespondToCIAgentBuilder(
	client: LLMist,
	ctx: CIContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	// Initialize session state for gadgets
	initSessionState('respond-to-ci');

	// Check if AU features should be enabled (repo has .au file at root)
	const auEnabled = existsSync(join(repoDir, '.au'));

	// Build gadget list
	const baseGadgets = [
		// Filesystem gadgets
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new WriteFile(),
		new RipGrep(),
		new AstGrep(),
		// Shell commands via tmux
		new Tmux(),
		new Sleep(),
		// Task tracking gadgets
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		// GitHub gadgets
		new GetPRDetails(),
		new GetPRDiff(),
		new PostPRComment(),
		new UpdatePRComment(),
		// Session control
		new Finish(),
	];

	const allGadgets = auEnabled ? [...baseGadgets, auList, auRead] : baseGadgets;

	return new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(ctx.model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig('respond-to-ci'))
		.withTrailingMessage(getIterationTrailingMessage('respond-to-ci'))
		.withTextOnlyHandler('acknowledge')
		.withHooks({
			observers: createObserverHooks({
				model: ctx.model,
				logWriter,
				trackingContext,
				llmCallLogger,
			}),
		})
		.withGadgets(...allGadgets);
}

async function injectCISyntheticCalls(
	initialBuilder: BuilderType,
	owner: string,
	repo: string,
	prNumber: number,
	ctx: CIContextData,
	trackingContext: TrackingContext,
	auEnabled: boolean,
): Promise<BuilderType> {
	let builder = initialBuilder;

	// Post initial "getting to work" comment on the PR
	const initialCommentBody = '🤖 Working on fixing CI failures...';
	const initialComment = await githubClient.createPRComment(
		owner,
		repo,
		prNumber,
		initialCommentBody,
	);
	recordInitialComment(initialComment.id);
	recordSyntheticInvocationId(trackingContext, 'gc_initial_comment');
	builder = builder.withSyntheticGadgetCall(
		'PostPRComment',
		{
			comment: 'Acknowledge CI failures',
			owner,
			repo,
			prNumber,
			body: initialCommentBody,
		},
		`Comment posted (id: ${initialComment.id}): ${initialComment.htmlUrl}`,
		'gc_initial_comment',
	);

	// Inject directory listing as synthetic ListDirectory call (first for codebase orientation)
	const listDirGadget = new ListDirectory();
	const listDirParams = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: '.',
		maxDepth: 3,
		includeGitIgnored: false,
	};
	const listDirResult = listDirGadget.execute(listDirParams);
	recordSyntheticInvocationId(trackingContext, 'gc_dir');
	builder = builder.withSyntheticGadgetCall(
		'ListDirectory',
		listDirParams,
		listDirResult,
		'gc_dir',
	);

	// Inject PR details
	recordSyntheticInvocationId(trackingContext, 'gc_pr_details');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDetails',
		{ comment: 'Pre-fetching PR details for context', owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	// Inject PR diff
	recordSyntheticInvocationId(trackingContext, 'gc_pr_diff');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDiff',
		{ comment: 'Pre-fetching PR diff for context', owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	// Inject check status summary
	recordSyntheticInvocationId(trackingContext, 'gc_check_status');
	builder = builder.withSyntheticGadgetCall(
		'GetCheckStatus',
		{ comment: 'Pre-fetching CI check status', owner, repo, prNumber },
		ctx.checkStatusFormatted,
		'gc_check_status',
	);

	// Inject failed check logs
	recordSyntheticInvocationId(trackingContext, 'gc_failed_logs');
	builder = builder.withSyntheticGadgetCall(
		'GetFailedCheckLogs',
		{ comment: 'Pre-fetching failed CI check logs', owner, repo, prNumber },
		ctx.failedLogsFormatted,
		'gc_failed_logs',
	);

	// Inject context files
	for (let i = 0; i < ctx.contextFiles.length; i++) {
		const file = ctx.contextFiles[i];
		const invocationId = `gc_init_${i + 1}`;
		recordSyntheticInvocationId(trackingContext, invocationId);
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ comment: `Pre-fetching ${file.path} for project context`, filePath: file.path },
			file.content,
			invocationId,
		);
	}

	// Inject AU understanding if enabled (gives agent immediate codebase context)
	if (auEnabled) {
		const auListResult = (await auList.execute({
			comment: 'Pre-fetching AU entries for context',
			path: '.',
		})) as string;
		// Only inject if there's actual content
		if (auListResult && !auListResult.includes('No AU entries found')) {
			recordSyntheticInvocationId(trackingContext, 'gc_au_list');
			builder = builder.withSyntheticGadgetCall(
				'AUList',
				{ comment: 'Pre-fetching AU entries for context', path: '.' },
				auListResult,
				'gc_au_list',
			);

			// Also inject root-level understanding for high-level context
			const auReadResult = (await auRead.execute({
				comment: 'Pre-fetching root-level understanding',
				paths: '.',
			})) as string;
			if (auReadResult && !auReadResult.includes('No understanding exists yet')) {
				recordSyntheticInvocationId(trackingContext, 'gc_au_read');
				builder = builder.withSyntheticGadgetCall(
					'AURead',
					{ comment: 'Pre-fetching root-level understanding', paths: '.' },
					auReadResult,
					'gc_au_read',
				);
			}
		}
	}

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

	let repoDir: string | null = null;

	// Create file logger for this agent run
	const fileLogger = createFileLogger(`cascade-ci-${prNumber}`);
	const log = createAgentLogger(fileLogger);

	// Register cleanup callback for watchdog timeout
	setWatchdogCleanup(async () => {
		fileLogger.close();
		// For CI agent, we post a comment to the PR instead of attaching logs to Trello
		await githubClient.createPRComment(
			owner,
			repo,
			prNumber,
			'⚠️ CI fix agent timed out while attempting to fix failures.',
		);
		logger.info('Posted timeout notice to PR', { prNumber });
	});

	try {
		// Setup repository
		repoDir = await setupRepository(project, prBranch, log);

		log.info('Running CI fix agent', { prNumber, repoFullName, repoDir, headSha });

		// Build context
		const ctx = await buildCIContext(
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
		);

		// Change to repo directory
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
		});

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			// Create tracking context for iterations and gadget calls
			const trackingContext = createTrackingContext();

			// Check if AU features should be enabled (repo has .au file at root)
			const auEnabled = existsSync(join(repoDir, '.au'));

			// Build agent with gadgets and synthetic calls
			let builder = createRespondToCIAgentBuilder(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
			);
			builder = await injectCISyntheticCalls(
				builder,
				owner,
				repo,
				prNumber,
				ctx,
				trackingContext,
				auEnabled,
			);

			// Run the agent
			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(
				agent,
				log,
				trackingContext,
				interactive === true,
				autoAccept === true,
			);

			log.info('CI fix agent completed', {
				prNumber,
				iterations: result.iterations,
				gadgetCalls: result.gadgetCalls,
				cost: result.cost,
			});

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: true,
				output: result.output,
				logBuffer,
				cost: result.cost,
			};
		} finally {
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('CI fix agent execution failed', { prNumber, error: String(err) });

		let logBuffer: Buffer | undefined;
		try {
			fileLogger.close();
			logBuffer = await fileLogger.getZippedBuffer();
		} catch {
			// Ignore log buffer errors
		}

		return {
			success: false,
			output: '',
			error: String(err),
			logBuffer,
		};
	} finally {
		clearWatchdogCleanup();

		// Skip cleanup in local mode to preserve logs for debugging
		const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

		if (repoDir && !isLocalMode) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		if (!isLocalMode) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
			cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
		}
	}
}
