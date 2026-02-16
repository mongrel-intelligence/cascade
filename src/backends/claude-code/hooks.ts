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
 */
export function buildPreToolUseHooks(logWriter: LogWriter): HookCallbackMatcher[] {
	return [
		{
			matcher: 'Bash',
			hooks: [
				async (input: HookInput): Promise<SyncHookJSONOutput> => {
					const hookInput = input as PreToolUseHookInput;
					const toolInput = hookInput.tool_input as { command?: string };
					const command = toolInput.command ?? '';

					for (const { pattern, reason } of BLOCKED_PATTERNS) {
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
					const response = String(hookInput.tool_response ?? '');
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

/**
 * Build Stop hooks that block session completion when unpushed commits exist.
 *
 * Uses a multi-strategy approach to avoid the loophole where `git log @{upstream}..HEAD`
 * fails when the branch has no upstream tracking (e.g., push never succeeded), causing
 * the catch block to silently allow stop.
 */
export function buildStopHooks(logWriter: LogWriter, repoDir: string): HookCallbackMatcher[] {
	return [
		{
			hooks: [
				async (): Promise<SyncHookJSONOutput> => {
					try {
						// Strategy 1: Check for uncommitted changes
						const status = execSync('git status --porcelain', {
							cwd: repoDir,
							encoding: 'utf-8',
							timeout: 10_000,
						}).trim();

						if (status) {
							logWriter('WARN', 'Stop hook blocked: uncommitted changes', {
								status,
							});
							return {
								decision: 'block',
								reason:
									'You have uncommitted changes. Stage, commit, then use cascade-tools github create-pr.',
							};
						}

						// Strategy 2: Check for unpushed commits on ANY branch
						// Uses --branches --not --remotes which works even without upstream tracking
						const unpushed = execSync('git log --branches --not --remotes --oneline', {
							cwd: repoDir,
							encoding: 'utf-8',
							timeout: 10_000,
						}).trim();

						if (unpushed) {
							logWriter('WARN', 'Stop hook blocked: unpushed commits', {
								commits: unpushed,
							});
							return {
								decision: 'block',
								reason:
									'You have unpushed commits. Use cascade-tools github create-pr to push and create a PR.',
							};
						}
					} catch {
						// Git commands failed entirely — still block if on a non-default branch
						// (the agent likely created a branch and made changes but something went wrong)
						try {
							const branch = execSync('git branch --show-current', {
								cwd: repoDir,
								encoding: 'utf-8',
								timeout: 5_000,
							}).trim();
							const isDefaultBranch = ['main', 'master', 'dev'].includes(branch);
							if (!isDefaultBranch) {
								logWriter('WARN', 'Stop hook blocked: on non-default branch with git errors', {
									branch,
								});
								return {
									decision: 'block',
									reason: `On non-default branch '${branch}' — use cascade-tools github create-pr to push and create a PR.`,
								};
							}
						} catch {
							logWriter('DEBUG', 'Stop hook: all git checks failed, allowing stop');
						}
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
 *   Should be true for implementation agents, false for briefing/planning/review agents.
 */
export function buildHooks(
	logWriter: LogWriter,
	repoDir: string,
	enableStopHooks = true,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	return {
		PreToolUse: buildPreToolUseHooks(logWriter),
		PostToolUse: buildPostToolUseHooks(logWriter),
		PostToolUseFailure: buildPostToolUseFailureHooks(logWriter),
		...(enableStopHooks && { Stop: buildStopHooks(logWriter, repoDir) }),
	};
}
