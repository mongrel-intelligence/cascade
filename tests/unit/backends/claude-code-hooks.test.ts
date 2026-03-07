import { execSync } from 'node:child_process';
import type {
	PostToolUseFailureHookInput,
	PostToolUseHookInput,
	PreToolUseHookInput,
	StopHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildHooks,
	buildPostToolUseFailureHooks,
	buildPostToolUseHooks,
	buildPreToolUseHooks,
	buildStopHooks,
} from '../../../src/backends/claude-code/hooks.js';
import type { LogWriter } from '../../../src/backends/types.js';

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

function makeLogWriter(): LogWriter {
	return vi.fn();
}

function makePreToolUseInput(command: string): PreToolUseHookInput {
	return {
		hook_event_name: 'PreToolUse',
		tool_name: 'Bash',
		tool_input: { command },
		tool_use_id: 'tu-1',
		session_id: 's1',
		transcript_path: '/tmp/transcript',
		cwd: '/tmp/repo',
	};
}

function makeStopInput(): StopHookInput {
	return {
		hook_event_name: 'Stop',
		stop_hook_active: true,
		session_id: 's1',
		transcript_path: '/tmp/transcript',
		cwd: '/tmp/repo',
	};
}

describe('buildPreToolUseHooks', () => {
	it('blocks gh pr create commands', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPreToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(
			makePreToolUseInput('gh pr create --title "test" --body "body"'),
			'tu-1',
			{ signal: AbortSignal.timeout(5000) },
		);

		expect(result).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: expect.stringContaining('cascade-tools github create-pr'),
			},
		});
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Hook blocked command',
			expect.objectContaining({
				command: expect.stringContaining('gh pr create'),
			}),
		);
	});

	it('blocks gh pr merge commands', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPreToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(makePreToolUseInput('gh pr merge 42 --squash'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(result).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: expect.stringContaining('Merging is managed externally'),
			},
		});
	});

	it('blocks git push commands', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPreToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(makePreToolUseInput('git push origin feature-branch'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(result).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: expect.stringContaining('cascade-tools github create-pr'),
			},
		});
	});

	it('allows normal Bash commands', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPreToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(makePreToolUseInput('npm test'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(result).toEqual({});
		expect(logWriter).not.toHaveBeenCalled();
	});

	it('allows cascade-tools github create-pr', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPreToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(
			makePreToolUseInput('cascade-tools github create-pr --title "feat" --body "desc"'),
			'tu-1',
			{ signal: AbortSignal.timeout(5000) },
		);

		expect(result).toEqual({});
		expect(logWriter).not.toHaveBeenCalled();
	});

	it('matches Bash tool via matcher field', () => {
		const [matcher] = buildPreToolUseHooks(makeLogWriter());
		expect(matcher.matcher).toBe('Bash');
	});

	describe('with blockGitPush: false', () => {
		it('allows git push commands', async () => {
			const logWriter = makeLogWriter();
			const [matcher] = buildPreToolUseHooks(logWriter, { blockGitPush: false });
			const [hook] = matcher.hooks;

			const result = await hook(makePreToolUseInput('git push origin feature-branch'), 'tu-1', {
				signal: AbortSignal.timeout(5000),
			});

			expect(result).toEqual({});
			expect(logWriter).not.toHaveBeenCalled();
		});

		it('still blocks gh pr create commands', async () => {
			const logWriter = makeLogWriter();
			const [matcher] = buildPreToolUseHooks(logWriter, { blockGitPush: false });
			const [hook] = matcher.hooks;

			const result = await hook(
				makePreToolUseInput('gh pr create --title "test" --body "body"'),
				'tu-1',
				{ signal: AbortSignal.timeout(5000) },
			);

			expect(result).toEqual({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'deny',
					permissionDecisionReason: expect.stringContaining('cascade-tools github create-pr'),
				},
			});
		});

		it('still blocks gh pr merge commands', async () => {
			const logWriter = makeLogWriter();
			const [matcher] = buildPreToolUseHooks(logWriter, { blockGitPush: false });
			const [hook] = matcher.hooks;

			const result = await hook(makePreToolUseInput('gh pr merge 42 --squash'), 'tu-1', {
				signal: AbortSignal.timeout(5000),
			});

			expect(result).toEqual({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'deny',
					permissionDecisionReason: expect.stringContaining('Merging is managed externally'),
				},
			});
		});
	});
});

describe('buildStopHooks', () => {
	it('blocks when uncommitted changes exist', async () => {
		mockExecSync.mockReturnValueOnce(' M src/index.ts');

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({
			decision: 'block',
			reason: expect.stringContaining('uncommitted changes'),
		});
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Stop hook blocked: uncommitted changes',
			expect.objectContaining({ status: 'M src/index.ts' }),
		);
		expect(mockExecSync).toHaveBeenCalledWith(
			'git status --porcelain',
			expect.objectContaining({ cwd: '/tmp/repo' }),
		);
	});

	it('blocks when unpushed commits exist (no upstream tracking)', async () => {
		// git status --porcelain returns clean
		mockExecSync.mockReturnValueOnce('');
		// git log --branches --not --remotes returns unpushed commits
		mockExecSync.mockReturnValueOnce('abc1234 feat: add feature\ndef5678 fix: bug fix');

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({
			decision: 'block',
			reason: expect.stringContaining('unpushed commits'),
		});
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Stop hook blocked: unpushed commits',
			expect.objectContaining({
				commits: expect.stringContaining('abc1234'),
			}),
		);
		expect(mockExecSync).toHaveBeenCalledWith(
			'git log --branches --not --remotes --oneline',
			expect.objectContaining({ cwd: '/tmp/repo' }),
		);
	});

	it('approves when no uncommitted changes and no unpushed commits', async () => {
		mockExecSync.mockReturnValueOnce(''); // git status --porcelain
		mockExecSync.mockReturnValueOnce(''); // git log --branches --not --remotes

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({ decision: 'approve' });
		expect(logWriter).not.toHaveBeenCalledWith('WARN', expect.anything(), expect.anything());
	});

	it('blocks on non-default branch when git commands fail', async () => {
		// Primary commands fail
		mockExecSync.mockImplementationOnce(() => {
			throw new Error('git status failed');
		});
		// Fallback: git branch --show-current returns non-default branch
		mockExecSync.mockReturnValueOnce('feature/my-branch');

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({
			decision: 'block',
			reason: expect.stringContaining("non-default branch 'feature/my-branch'"),
		});
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Stop hook blocked: on non-default branch with git errors',
			expect.objectContaining({ branch: 'feature/my-branch' }),
		);
	});

	it('approves on default branch when git commands fail', async () => {
		// Primary commands fail
		mockExecSync.mockImplementationOnce(() => {
			throw new Error('git status failed');
		});
		// Fallback: git branch --show-current returns default branch
		mockExecSync.mockReturnValueOnce('main');

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({ decision: 'approve' });
	});

	it('approves gracefully when all git commands fail', async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('fatal: not a git repository');
		});

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({ decision: 'approve' });
		expect(logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'Stop hook: all git checks failed, allowing stop',
		);
	});

	describe('with blockGitPush: false', () => {
		it('uses "git push" message for unpushed commits', async () => {
			mockExecSync.mockReturnValueOnce(''); // git status --porcelain
			mockExecSync.mockReturnValueOnce('abc1234 feat: add feature'); // unpushed commits

			const logWriter = makeLogWriter();
			const [matcher] = buildStopHooks(logWriter, '/tmp/repo', { blockGitPush: false });
			const [hook] = matcher.hooks;

			const result = await hook(makeStopInput(), undefined, {
				signal: AbortSignal.timeout(5000),
			});

			expect(result).toEqual({
				decision: 'block',
				reason: 'You have unpushed commits. Push your changes with git push before finishing.',
			});
		});

		it('uses "git push" message for non-default branch fallback', async () => {
			mockExecSync.mockImplementationOnce(() => {
				throw new Error('git status failed');
			});
			mockExecSync.mockReturnValueOnce('feature/my-branch');

			const logWriter = makeLogWriter();
			const [matcher] = buildStopHooks(logWriter, '/tmp/repo', { blockGitPush: false });
			const [hook] = matcher.hooks;

			const result = await hook(makeStopInput(), undefined, {
				signal: AbortSignal.timeout(5000),
			});

			expect(result).toEqual({
				decision: 'block',
				reason: expect.stringContaining('push your changes with git push before finishing'),
			});
		});
	});
});

describe('buildPostToolUseHooks', () => {
	function makePostToolUseInput(toolName: string, toolResponse: unknown): PostToolUseHookInput {
		return {
			hook_event_name: 'PostToolUse',
			tool_name: toolName,
			tool_input: {},
			tool_response: toolResponse,
			tool_use_id: 'tu-1',
			session_id: 's1',
			transcript_path: '/tmp/transcript',
			cwd: '/tmp/repo',
		};
	}

	it('logs tool result', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(makePostToolUseInput('Read', 'file content here'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(result).toEqual({});
		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Read',
			result: 'file content here',
		});
	});

	it('truncates long tool results', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const longResponse = 'x'.repeat(600);
		await hook(makePostToolUseInput('Bash', longResponse), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Bash',
			result: `${'x'.repeat(500)}... (600 chars)`,
		});
	});

	it('handles null tool response', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		await hook(makePostToolUseInput('Read', null), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Read',
			result: '',
		});
	});

	it('serializes object tool response as JSON instead of [object Object]', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const objectResponse = { success: true, data: { id: 'abc', name: 'test' } };
		await hook(makePostToolUseInput('Bash', objectResponse), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Bash',
			result: JSON.stringify(objectResponse),
		});
	});

	it('serializes array tool response as JSON', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const arrayResponse = [{ file: 'a.ts' }, { file: 'b.ts' }];
		await hook(makePostToolUseInput('Glob', arrayResponse), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Glob',
			result: JSON.stringify(arrayResponse),
		});
	});

	it('truncates long JSON-serialized object responses', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseHooks(logWriter);
		const [hook] = matcher.hooks;

		const largeObject = { data: 'x'.repeat(600) };
		const serialized = JSON.stringify(largeObject);
		await hook(makePostToolUseInput('Bash', largeObject), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool result', {
			tool: 'Bash',
			result: `${serialized.slice(0, 500)}... (${serialized.length} chars)`,
		});
	});
});

describe('buildPostToolUseFailureHooks', () => {
	function makePostToolUseFailureInput(
		toolName: string,
		error: string,
	): PostToolUseFailureHookInput {
		return {
			hook_event_name: 'PostToolUseFailure',
			tool_name: toolName,
			tool_input: {},
			tool_use_id: 'tu-1',
			error,
			session_id: 's1',
			transcript_path: '/tmp/transcript',
			cwd: '/tmp/repo',
		};
	}

	it('logs tool failure', async () => {
		const logWriter = makeLogWriter();
		const [matcher] = buildPostToolUseFailureHooks(logWriter);
		const [hook] = matcher.hooks;

		const result = await hook(makePostToolUseFailureInput('Bash', 'Permission denied'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});

		expect(result).toEqual({});
		expect(logWriter).toHaveBeenCalledWith('ERROR', 'Tool failed', {
			tool: 'Bash',
			error: 'Permission denied',
		});
	});
});

describe('buildHooks', () => {
	it('returns all hook matchers', () => {
		const hooks = buildHooks(makeLogWriter(), '/tmp/repo');

		expect(hooks.PreToolUse).toBeDefined();
		expect(hooks.PreToolUse).toHaveLength(1);
		expect(hooks.PreToolUse?.[0].matcher).toBe('Bash');

		expect(hooks.PostToolUse).toBeDefined();
		expect(hooks.PostToolUse).toHaveLength(1);

		expect(hooks.PostToolUseFailure).toBeDefined();
		expect(hooks.PostToolUseFailure).toHaveLength(1);

		expect(hooks.Stop).toBeDefined();
		expect(hooks.Stop).toHaveLength(1);
	});

	it('threads blockGitPush option to PreToolUse hooks', async () => {
		const hooks = buildHooks(makeLogWriter(), '/tmp/repo', true, { blockGitPush: false });

		const preToolUse = hooks.PreToolUse ?? [];
		const [matcher] = preToolUse;
		const [hook] = matcher.hooks;

		// git push should be allowed
		const result = await hook(makePreToolUseInput('git push origin main'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});
		expect(result).toEqual({});

		// gh pr create should still be blocked
		const result2 = await hook(makePreToolUseInput('gh pr create --title "test"'), 'tu-1', {
			signal: AbortSignal.timeout(5000),
		});
		expect(result2).toEqual({
			hookSpecificOutput: expect.objectContaining({
				permissionDecision: 'deny',
			}),
		});
	});
});
