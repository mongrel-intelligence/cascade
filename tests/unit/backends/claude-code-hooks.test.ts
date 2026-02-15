import { execSync } from 'node:child_process';
import type { PreToolUseHookInput, StopHookInput } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildHooks,
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

beforeEach(() => {
	vi.clearAllMocks();
});

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
});

describe('buildStopHooks', () => {
	it('blocks when unpushed commits exist', async () => {
		mockExecSync.mockReturnValue('abc1234 feat: add feature\ndef5678 fix: bug fix');

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
			'git log origin/HEAD..HEAD --oneline',
			expect.objectContaining({ cwd: '/tmp/repo' }),
		);
	});

	it('approves when no unpushed commits', async () => {
		mockExecSync.mockReturnValue('');

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({ decision: 'approve' });
		expect(logWriter).not.toHaveBeenCalledWith('WARN', expect.anything(), expect.anything());
	});

	it('approves gracefully when git command fails', async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('fatal: no upstream configured');
		});

		const logWriter = makeLogWriter();
		const [matcher] = buildStopHooks(logWriter, '/tmp/repo');
		const [hook] = matcher.hooks;

		const result = await hook(makeStopInput(), undefined, { signal: AbortSignal.timeout(5000) });

		expect(result).toEqual({ decision: 'approve' });
		expect(logWriter).toHaveBeenCalledWith('DEBUG', 'Stop hook: git check failed, allowing stop');
	});
});

describe('buildHooks', () => {
	it('returns PreToolUse and Stop hook matchers', () => {
		const hooks = buildHooks(makeLogWriter(), '/tmp/repo');

		expect(hooks.PreToolUse).toBeDefined();
		expect(hooks.PreToolUse).toHaveLength(1);
		expect(hooks.PreToolUse?.[0].matcher).toBe('Bash');

		expect(hooks.Stop).toBeDefined();
		expect(hooks.Stop).toHaveLength(1);
	});
});
