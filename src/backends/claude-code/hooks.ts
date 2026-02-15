import { execSync } from 'node:child_process';
import type {
	HookCallbackMatcher,
	HookEvent,
	HookInput,
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
 * Build Stop hooks that block session completion when unpushed commits exist.
 */
export function buildStopHooks(logWriter: LogWriter, repoDir: string): HookCallbackMatcher[] {
	return [
		{
			hooks: [
				async (): Promise<SyncHookJSONOutput> => {
					try {
						const output = execSync('git log origin/HEAD..HEAD --oneline', {
							cwd: repoDir,
							encoding: 'utf-8',
							timeout: 10_000,
						}).trim();

						if (output) {
							const reason =
								'You have unpushed commits. Use cascade-tools github create-pr to push and create a PR.';
							logWriter('WARN', 'Stop hook blocked: unpushed commits', {
								commits: output,
							});
							return { decision: 'block', reason };
						}
					} catch {
						// If git command fails (e.g., no remote), don't block
						logWriter('DEBUG', 'Stop hook: git check failed, allowing stop');
					}

					return { decision: 'approve' };
				},
			],
		},
	];
}

/**
 * Build all SDK hooks for the Claude Code backend.
 */
export function buildHooks(
	logWriter: LogWriter,
	repoDir: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	return {
		PreToolUse: buildPreToolUseHooks(logWriter),
		Stop: buildStopHooks(logWriter, repoDir),
	};
}
