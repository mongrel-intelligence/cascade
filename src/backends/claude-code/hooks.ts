import { execSync } from 'node:child_process';
import type {
	HookCallbackMatcher,
	HookEvent,
	HookInput,
	PostToolUseFailureHookInput,
	PostToolUseHookInput,
	PreToolUseHookInput,
	SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type { LogWriter } from '../types.js';

/**
 * Patterns blocked in Bash tool commands.
 * Each entry maps a regex pattern to a human-readable deny reason.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\bgh\s+pr\s+create\b/,
		reason:
			'Do not use `gh pr create`. Use `cascade-tools github create-pr` instead — it pushes the branch and creates the PR atomically.',
	},
	{
		pattern: /\bgh\s+pr\s+merge\b/,
		reason:
			'Do not use `gh pr merge`. Merging is managed externally. Use `cascade-tools github create-pr` to create PRs.',
	},
	{
		pattern: /\bgit\s+push\b/,
		reason:
			'Do not use `git push` directly. Use `cascade-tools github create-pr` instead — it handles push atomically.',
	},
];

/**
 * Build PreToolUse hooks that block dangerous Bash commands.
 *
 * @param options.blockGitPush - When false, allows `git push` (for agents on existing PR branches).
 *   Defaults to true (block git push, redirect to cascade-tools github create-pr).
 */
export function buildPreToolUseHooks(
	logWriter: LogWriter,
	options?: { blockGitPush?: boolean },
): HookCallbackMatcher[] {
	const blockGitPush = options?.blockGitPush ?? true;
	const patterns = blockGitPush
		? BLOCKED_PATTERNS
		: BLOCKED_PATTERNS.filter((p) => !p.pattern.source.includes('git\\s+push'));

	return [
		{
			matcher: 'Bash',
			hooks: [
				async (input: HookInput): Promise<SyncHookJSONOutput> => {
					const hookInput = input as PreToolUseHookInput;
					const toolInput = hookInput.tool_input as { command?: string };
					const command = toolInput.command ?? '';

					for (const { pattern, reason } of patterns) {
						if (pattern.test(command)) {
							logWriter('WARN', 'Hook blocked command', { command, reason });
							return {
								hookSpecificOutput: {
									hookEventName: 'PreToolUse' as const,
									permissionDecision: 'deny' as const,
									permissionDecisionReason: reason,
								},
							};
						}
					}

					return {};
				},
			],
		},
	];
}

/**
 * Build PostToolUse hooks that log tool results (truncated).
 */
export function buildPostToolUseHooks(logWriter: LogWriter): HookCallbackMatcher[] {
	return [
		{
			hooks: [
				async (input: HookInput): Promise<SyncHookJSONOutput> => {
					const hookInput = input as PostToolUseHookInput;
					const raw = hookInput.tool_response ?? '';
					const response = typeof raw === 'string' ? raw : JSON.stringify(raw);
					const truncated =
						response.length > 500
							? `${response.slice(0, 500)}... (${response.length} chars)`
							: response;
					logWriter('INFO', 'Tool result', {
						tool: hookInput.tool_name,
						result: truncated,
					});
					return {};
				},
			],
		},
	];
}

/**
 * Build PostToolUseFailure hooks that log tool errors.
 */
export function buildPostToolUseFailureHooks(logWriter: LogWriter): HookCallbackMatcher[] {
	return [
		{
			hooks: [
				async (input: HookInput): Promise<SyncHookJSONOutput> => {
					const hookInput = input as PostToolUseFailureHookInput;
					logWriter('ERROR', 'Tool failed', {
						tool: hookInput.tool_name,
						error: hookInput.error,
					});
					return {};
				},
			],
		},
	];
}

/** Check for uncommitted changes. Returns a block response or null. */
function checkUncommittedChanges(logWriter: LogWriter, repoDir: string): SyncHookJSONOutput | null {
	const status = execSync('git status --porcelain', {
		cwd: repoDir,
		encoding: 'utf-8',
		timeout: 10_000,
	}).trim();
	if (!status) return null;

	logWriter('WARN', 'Stop hook blocked: uncommitted changes', { status });
	return {
		decision: 'block',
		reason: 'You have uncommitted changes. Stage, commit, then use cascade-tools github create-pr.',
	};
}

/** Check for unpushed commits. Returns a block response or null. */
function checkUnpushedCommits(
	logWriter: LogWriter,
	repoDir: string,
	blockGitPush: boolean,
): SyncHookJSONOutput | null {
	const unpushed = execSync('git log --branches --not --remotes --oneline', {
		cwd: repoDir,
		encoding: 'utf-8',
		timeout: 10_000,
	}).trim();
	if (!unpushed) return null;

	logWriter('WARN', 'Stop hook blocked: unpushed commits', { commits: unpushed });
	return {
		decision: 'block',
		reason: blockGitPush
			? 'You have unpushed commits. Use cascade-tools github create-pr to push and create a PR.'
			: 'You have unpushed commits. Push your changes with git push before finishing.',
	};
}

/** Fallback: block if on a non-default branch (git log/status failed). */
function checkNonDefaultBranch(
	logWriter: LogWriter,
	repoDir: string,
	blockGitPush: boolean,
): SyncHookJSONOutput | null {
	try {
		const branch = execSync('git branch --show-current', {
			cwd: repoDir,
			encoding: 'utf-8',
			timeout: 5_000,
		}).trim();
		if (['main', 'master', 'dev'].includes(branch)) return null;

		logWriter('WARN', 'Stop hook blocked: on non-default branch with git errors', { branch });
		return {
			decision: 'block',
			reason: blockGitPush
				? `On non-default branch '${branch}' — use cascade-tools github create-pr to push and create a PR.`
				: `On non-default branch '${branch}' with git errors — push your changes with git push before finishing.`,
		};
	} catch {
		logWriter('DEBUG', 'Stop hook: all git checks failed, allowing stop');
		return null;
	}
}

/**
 * Build Stop hooks that block session completion when unpushed commits exist.
 *
 * Uses a multi-strategy approach to avoid the loophole where `git log @{upstream}..HEAD`
 * fails when the branch has no upstream tracking (e.g., push never succeeded), causing
 * the catch block to silently allow stop.
 *
 * @param options.blockGitPush - When false, stop hook messages tell the agent to use
 *   `git push` instead of `cascade-tools github create-pr`. Defaults to true.
 */
export function buildStopHooks(
	logWriter: LogWriter,
	repoDir: string,
	options?: { blockGitPush?: boolean },
): HookCallbackMatcher[] {
	const blockGitPush = options?.blockGitPush ?? true;

	return [
		{
			hooks: [
				async (): Promise<SyncHookJSONOutput> => {
					try {
						const uncommitted = checkUncommittedChanges(logWriter, repoDir);
						if (uncommitted) return uncommitted;

						const unpushed = checkUnpushedCommits(logWriter, repoDir, blockGitPush);
						if (unpushed) return unpushed;
					} catch {
						const branchBlock = checkNonDefaultBranch(logWriter, repoDir, blockGitPush);
						if (branchBlock) return branchBlock;
					}

					return { decision: 'approve' };
				},
			],
		},
	];
}

/**
 * Build all SDK hooks for the Claude Code backend.
 *
 * @param enableStopHooks - Whether to include Stop hooks that check for uncommitted/unpushed changes.
 *   Should be true for implementation agents, false for splitting/planning/review agents.
 * @param options.blockGitPush - Whether to block git push in hooks (defaults to true).
 *   Set false for agents on existing PR branches (respond-to-pr-comment, respond-to-ci).
 */
export function buildHooks(
	logWriter: LogWriter,
	repoDir: string,
	enableStopHooks = true,
	options?: { blockGitPush?: boolean },
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	return {
		PreToolUse: buildPreToolUseHooks(logWriter, options),
		PostToolUse: buildPostToolUseHooks(logWriter),
		PostToolUseFailure: buildPostToolUseFailureHooks(logWriter),
		...(enableStopHooks && { Stop: buildStopHooks(logWriter, repoDir, options) }),
	};
}
