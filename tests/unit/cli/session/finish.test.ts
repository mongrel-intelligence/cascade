import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		getOpenPRByBranch: vi.fn(),
	},
}));

import FinishCommand from '../../../../src/cli/session/finish.js';

describe('session finish CLI', () => {
	let pushedChangesSidecarPath: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		pushedChangesSidecarPath = join(tmpdir(), `cascade-test-finish-sidecar-${Date.now()}.json`);
		originalEnv = { ...process.env };
		process.env.CASCADE_PUSHED_CHANGES_SIDECAR_PATH = pushedChangesSidecarPath;
		process.env.CASCADE_FINISH_HOOKS = JSON.stringify({ requiresPushedChanges: true });
		process.env.CASCADE_INITIAL_HEAD_SHA = 'a'.repeat(40);
		process.env.CASCADE_AGENT_TYPE = 'respond-to-review';
	});

	afterEach(() => {
		rmSync(pushedChangesSidecarPath, { force: true });
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	it('writes pushed-changes sidecar after successful validation', async () => {
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('status --porcelain')) return '';
			if (cmd.includes('rev-list')) return '0';
			if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feat/review-fixes';
			if (cmd === 'git rev-parse HEAD') return 'b'.repeat(40);
			return '';
		});

		const cmd = new FinishCommand([], {} as never);
		cmd.log = vi.fn();
		cmd.parse = vi.fn().mockResolvedValue({
			flags: {
				comment: 'Done',
				'pr-created': false,
				'review-submitted': false,
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await cmd.run();

		expect(existsSync(pushedChangesSidecarPath)).toBe(true);
		expect(JSON.parse(readFileSync(pushedChangesSidecarPath, 'utf-8'))).toEqual({
			source: 'cascade-tools session finish',
			branch: 'feat/review-fixes',
			headSha: 'b'.repeat(40),
		});
		expect(cmd.log).toHaveBeenCalledWith(
			JSON.stringify({ success: true, data: 'Session ended: Done' }),
		);
	});

	it('fails when pushed changes were not actually made', async () => {
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('status --porcelain')) return '';
			if (cmd.includes('rev-list')) return '0';
			if (cmd === 'git rev-parse HEAD') return 'a'.repeat(40);
			return '';
		});

		const cmd = new FinishCommand([], {} as never);
		cmd.log = vi.fn();
		cmd.exit = vi.fn((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as never;
		cmd.parse = vi.fn().mockResolvedValue({
			flags: {
				comment: 'Done',
				'pr-created': false,
				'review-submitted': false,
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await expect(cmd.run()).rejects.toThrow('exit:1');
		expect(existsSync(pushedChangesSidecarPath)).toBe(false);
		expect(cmd.log).toHaveBeenCalledWith(
			JSON.stringify({
				success: false,
				error:
					'Cannot finish session without making any changes. You must commit and push at least one change before calling Finish.',
			}),
		);
	});
});
