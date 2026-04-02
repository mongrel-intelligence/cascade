import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailedError } from '../../../../src/gadgets/tmux/errors.js';

// ─── Mock the control client module ───────────────────────────────────────────
const mockClient = {
	windowExists: vi.fn<() => Promise<boolean>>(),
	createWindow: vi.fn<() => Promise<string>>(),
	killWindow: vi.fn<() => Promise<void>>(),
	sendKeys: vi.fn<() => Promise<void>>(),
	checkExitMarker: vi.fn<() => { exited: boolean; exitCode: number }>(),
	isPaneDead: vi.fn<() => Promise<{ dead: boolean; exitCode: number }>>(),
	getOutput: vi.fn<() => string>(),
	capturePaneOutput: vi.fn<() => Promise<string>>(),
	getSessionStatus:
		vi.fn<() => Promise<{ status: 'running' | 'exited' | 'not_found'; exitCode?: number }>>(),
	listWindows: vi.fn<() => Promise<string[]>>(),
};

vi.mock('../../../../src/gadgets/tmux/TmuxControlClient.js', () => ({
	getControlClient: vi.fn(async () => mockClient),
}));

// ─── Mock sleep so tests don't actually wait ──────────────────────────────────
vi.mock('../../../../src/gadgets/tmux/utils.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../../../src/gadgets/tmux/utils.js')>();
	return {
		...original,
		sleep: vi.fn(async () => {}),
	};
});

import { TmuxGadget } from '../../../../src/gadgets/tmux/TmuxGadget.js';

// Helper to invoke the gadget's execute method
async function execute(params: Record<string, unknown>): Promise<string> {
	const gadget = new TmuxGadget();
	return gadget.execute(params as Parameters<TmuxGadget['execute']>[0]);
}

describe('TmuxGadget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── start action ─────────────────────────────────────────────────────────
	describe('start action', () => {
		it('returns running status when command does not exit within wait period', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('%1');
			// Exit marker never found, pane never dead — command keeps "running"
			mockClient.checkExitMarker.mockReturnValue({ exited: false, exitCode: 0 });
			mockClient.isPaneDead.mockResolvedValue({ dead: false, exitCode: 0 });
			mockClient.getOutput.mockReturnValue('some output');
			mockClient.capturePaneOutput.mockResolvedValue('');

			const result = await execute({
				action: 'start',
				comment: 'test',
				session: 'my-session',
				command: 'npm test',
				// Use a very short wait so the loop exits quickly in tests
				wait: 100,
			});

			expect(result).toContain('status=running');
			expect(result).toContain('my-session');
		});

		it('returns exited status with exit_code=0 on successful command', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('%1');
			// Exit marker detected immediately
			mockClient.checkExitMarker.mockReturnValue({ exited: true, exitCode: 0 });
			mockClient.getOutput.mockReturnValue('all tests passed');
			mockClient.capturePaneOutput.mockResolvedValue('');
			mockClient.killWindow.mockResolvedValue(undefined);

			const result = await execute({
				action: 'start',
				comment: 'test',
				session: 'test-session',
				command: 'npm test',
				wait: 5000,
			});

			expect(result).toContain('status=exited');
			expect(result).toContain('exit_code=0');
			expect(result).toContain('all tests passed');
		});

		it('throws CommandFailedError when command exits with non-zero code', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('%1');
			mockClient.checkExitMarker.mockReturnValue({ exited: true, exitCode: 1 });
			mockClient.getOutput.mockReturnValue('test failed');
			mockClient.capturePaneOutput.mockResolvedValue('');
			mockClient.killWindow.mockResolvedValue(undefined);

			await expect(
				execute({
					action: 'start',
					comment: 'test',
					session: 'fail-session',
					command: 'npm test',
					wait: 5000,
				}),
			).rejects.toThrow(CommandFailedError);
		});

		it('returns error when session already exists', async () => {
			mockClient.windowExists.mockResolvedValue(true);

			const result = await execute({
				action: 'start',
				comment: 'test',
				session: 'existing-session',
				command: 'echo hello',
				wait: 5000,
			});

			expect(result).toContain('status=error');
			expect(result).toContain('existing-session');
			expect(result).toContain('already exists');
		});

		it('returns error when pane creation fails (paneId does not start with %)', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('error: something went wrong');

			const result = await execute({
				action: 'start',
				comment: 'test',
				session: 'bad-session',
				command: 'echo hello',
				wait: 5000,
			});

			expect(result).toContain('status=error');
			expect(result).toContain('Failed to create session');
		});

		it('blocks git commands with --no-verify flag', async () => {
			await expect(
				execute({
					action: 'start',
					comment: 'test',
					session: 'git-session',
					command: 'git commit --no-verify -m "test"',
					wait: 5000,
				}),
			).rejects.toThrow('--no-verify');
		});

		it('uses isPaneDead fallback when exit marker is not found', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('%1');
			// No exit marker, but pane is dead
			mockClient.checkExitMarker.mockReturnValue({ exited: false, exitCode: 0 });
			mockClient.isPaneDead.mockResolvedValue({ dead: true, exitCode: 0 });
			mockClient.getOutput.mockReturnValue('command output');
			mockClient.capturePaneOutput.mockResolvedValue('');
			mockClient.killWindow.mockResolvedValue(undefined);

			const result = await execute({
				action: 'start',
				comment: 'test',
				session: 'pane-dead-session',
				command: 'echo done',
				wait: 5000,
			});

			expect(result).toContain('status=exited');
			expect(result).toContain('exit_code=0');
		});
	});

	// ─── capture action ───────────────────────────────────────────────────────
	describe('capture action', () => {
		it('returns error when session does not exist', async () => {
			mockClient.getSessionStatus.mockResolvedValue({ status: 'not_found' });

			const result = await execute({
				action: 'capture',
				comment: 'test',
				session: 'nonexistent',
				lines: 25,
			});

			expect(result).toContain('status=error');
			expect(result).toContain('nonexistent');
			expect(result).toContain('does not exist');
		});

		it('returns running status for a running session', async () => {
			mockClient.getSessionStatus.mockResolvedValue({ status: 'running' });
			mockClient.getOutput.mockReturnValue('output line 1\noutput line 2');
			mockClient.capturePaneOutput.mockResolvedValue('');

			const result = await execute({
				action: 'capture',
				comment: 'test',
				session: 'running-session',
				lines: 25,
			});

			expect(result).toContain('status=running');
			expect(result).toContain('lines=25');
		});

		it('returns exited status with exit code for completed session', async () => {
			mockClient.getSessionStatus.mockResolvedValue({ status: 'exited', exitCode: 0 });
			mockClient.getOutput.mockReturnValue('done output');
			mockClient.capturePaneOutput.mockResolvedValue('');

			const result = await execute({
				action: 'capture',
				comment: 'test',
				session: 'done-session',
				lines: 10,
			});

			expect(result).toContain('status=exited');
			expect(result).toContain('exit_code=0');
			expect(result).toContain('lines=10');
		});

		it('respects lines parameter', async () => {
			mockClient.getSessionStatus.mockResolvedValue({ status: 'running' });
			// Return many lines, capture should truncate to requested lines
			const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
			mockClient.getOutput.mockReturnValue(manyLines);
			mockClient.capturePaneOutput.mockResolvedValue('');

			const result = await execute({
				action: 'capture',
				comment: 'test',
				session: 'session-with-many-lines',
				lines: 5,
			});

			expect(result).toContain('lines=5');
		});

		it('falls back to capturePaneOutput when getOutput returns empty', async () => {
			mockClient.getSessionStatus.mockResolvedValue({ status: 'running' });
			mockClient.getOutput.mockReturnValue('   ');
			mockClient.capturePaneOutput.mockResolvedValue('captured from pane');

			const result = await execute({
				action: 'capture',
				comment: 'test',
				session: 'empty-output-session',
				lines: 25,
			});

			expect(result).toContain('captured from pane');
		});
	});

	// ─── send action ──────────────────────────────────────────────────────────
	describe('send action', () => {
		it('returns error when session does not exist', async () => {
			mockClient.windowExists.mockResolvedValue(false);

			const result = await execute({
				action: 'send',
				comment: 'test',
				session: 'nonexistent',
				keys: 'C-c',
				enter: false,
			});

			expect(result).toContain('status=error');
			expect(result).toContain('nonexistent');
		});

		it('sends keys to existing session and returns sent status', async () => {
			mockClient.windowExists.mockResolvedValue(true);
			mockClient.sendKeys.mockResolvedValue(undefined);

			const result = await execute({
				action: 'send',
				comment: 'test',
				session: 'my-session',
				keys: 'C-c',
				enter: false,
			});

			expect(result).toContain('status=sent');
			expect(result).toContain('C-c');
			expect(mockClient.sendKeys).toHaveBeenCalledWith('my-session', 'C-c', false);
		});

		it('appends [Enter] note when enter=true', async () => {
			mockClient.windowExists.mockResolvedValue(true);
			mockClient.sendKeys.mockResolvedValue(undefined);

			const result = await execute({
				action: 'send',
				comment: 'test',
				session: 'my-session',
				keys: 'npm test',
				enter: true,
			});

			expect(result).toContain('[Enter]');
		});

		it('blocks git commands with --no-verify when enter=true', async () => {
			await expect(
				execute({
					action: 'send',
					comment: 'test',
					session: 'git-session',
					keys: 'git commit --no-verify -m "test"',
					enter: true,
				}),
			).rejects.toThrow('--no-verify');
		});

		it('does not validate git command when enter=false', async () => {
			mockClient.windowExists.mockResolvedValue(true);
			mockClient.sendKeys.mockResolvedValue(undefined);

			// Should not throw even though keys looks like a dangerous git command
			// when enter=false the command is not executed
			await expect(
				execute({
					action: 'send',
					comment: 'test',
					session: 'my-session',
					keys: 'git commit --no-verify',
					enter: false,
				}),
			).resolves.toContain('status=sent');
		});
	});

	// ─── kill action ──────────────────────────────────────────────────────────
	describe('kill action', () => {
		it('returns error when session does not exist', async () => {
			mockClient.windowExists.mockResolvedValue(false);

			const result = await execute({
				action: 'kill',
				comment: 'test',
				session: 'nonexistent',
			});

			expect(result).toContain('status=error');
		});

		it('kills existing session and returns killed status', async () => {
			mockClient.windowExists.mockResolvedValue(true);
			mockClient.killWindow.mockResolvedValue(undefined);

			const result = await execute({
				action: 'kill',
				comment: 'test',
				session: 'running-session',
			});

			expect(result).toContain('status=killed');
			expect(result).toContain('running-session');
			expect(mockClient.killWindow).toHaveBeenCalledWith('running-session');
		});
	});

	// ─── list action ──────────────────────────────────────────────────────────
	describe('list action', () => {
		it('returns session count and names', async () => {
			mockClient.listWindows.mockResolvedValue([
				'1:test-run npm (running)',
				'2:npm-install npm (running)',
			]);

			const result = await execute({
				action: 'list',
				comment: 'test',
			});

			expect(result).toContain('sessions=2');
		});

		it('returns sessions=0 when no windows exist', async () => {
			// listWindows filters out "0:" window, if it returns ["0: bash (running)"]
			// the filtered result is empty
			mockClient.listWindows.mockResolvedValue(['0: bash (running)']);

			const result = await execute({
				action: 'list',
				comment: 'test',
			});

			expect(result).toContain('sessions=0');
		});

		it('returns sessions=0 when listWindows throws', async () => {
			mockClient.listWindows.mockRejectedValue(new Error('tmux error'));

			const result = await execute({
				action: 'list',
				comment: 'test',
			});

			expect(result).toContain('sessions=0');
		});
	});

	// ─── exists action ────────────────────────────────────────────────────────
	describe('exists action', () => {
		it('returns exists=true for existing session', async () => {
			mockClient.windowExists.mockResolvedValue(true);

			const result = await execute({
				action: 'exists',
				comment: 'test',
				session: 'my-session',
			});

			expect(result).toContain('exists=true');
		});

		it('returns exists=false for nonexistent session', async () => {
			mockClient.windowExists.mockResolvedValue(false);

			const result = await execute({
				action: 'exists',
				comment: 'test',
				session: 'nonexistent',
			});

			expect(result).toContain('exists=false');
		});
	});

	// ─── session name sanitization ────────────────────────────────────────────
	describe('session name sanitization', () => {
		it('sanitizes session names with slashes', async () => {
			mockClient.windowExists.mockResolvedValue(false);
			mockClient.createWindow.mockResolvedValue('%1');
			mockClient.checkExitMarker.mockReturnValue({ exited: true, exitCode: 0 });
			mockClient.getOutput.mockReturnValue('output');
			mockClient.capturePaneOutput.mockResolvedValue('');
			mockClient.killWindow.mockResolvedValue(undefined);

			await execute({
				action: 'start',
				comment: 'test',
				session: 'feature/branch-name',
				command: 'echo hello',
				wait: 5000,
			});

			// The createWindow should be called with sanitized name (- instead of /)
			expect(mockClient.createWindow).toHaveBeenCalledWith(
				expect.stringMatching(/^feature-branch-name$/),
				'echo hello',
				undefined,
			);
		});
	});
});
