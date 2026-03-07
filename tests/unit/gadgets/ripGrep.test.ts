import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — spawn mock variable initialized before vi.mock factories
// ---------------------------------------------------------------------------

const { mockSpawn } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
}));

// Mock child_process.spawn so no real rg binary is required
vi.mock('node:child_process', () => ({
	spawn: mockSpawn,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { RipGrep } from '../../../src/gadgets/RipGrep.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fake child process that emits stdout/stderr and a close event.
 */
function makeProcess({
	stdout = '',
	stderr = '',
	exitCode = 0,
}: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}) {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};

	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();

	// Emit data + close asynchronously (next microtask tick)
	process.nextTick(() => {
		if (stdout) {
			proc.stdout.emit('data', Buffer.from(stdout));
		}
		if (stderr) {
			proc.stderr.emit('data', Buffer.from(stderr));
		}
		proc.emit('close', exitCode);
	});

	return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let gadget: RipGrep;

beforeEach(() => {
	gadget = new RipGrep();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('RipGrep', () => {
	describe('basic search', () => {
		it('returns matching lines from stdout', async () => {
			const output = 'src/utils.ts:5:export function helper() {}\n';
			mockSpawn.mockReturnValue(makeProcess({ stdout: output, exitCode: 0 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'function helper',
				path: '.',
			});

			expect(result).toBe(output);
		});

		it('includes --line-number and --no-heading flags', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: 'match\n', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'match', path: '.' });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('--line-number');
			expect(spawnArgs).toContain('--no-heading');
		});

		it('includes --color=never flag', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'anything', path: '.' });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('--color=never');
		});

		it('passes pattern and path as last two arguments', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'mypattern', path: 'src/' });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			// pattern and path are appended after flags
			expect(spawnArgs).toContain('mypattern');
			expect(spawnArgs).toContain('src/');
		});
	});

	describe('glob filter', () => {
		it('passes -g flag when glob is provided', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: 'result\n', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'foo', path: '.', glob: '*.ts' });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('-g');
			expect(spawnArgs).toContain('*.ts');
		});

		it('does not pass -g flag when glob is not provided', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'foo', path: '.' });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).not.toContain('-g');
		});
	});

	describe('maxResults', () => {
		it('passes -m flag with the provided maxResults value', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'foo', path: '.', maxResults: 50 });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('-m');
			expect(spawnArgs).toContain('50');
		});

		it('passes -m flag with value 100 when maxResults is 100', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'foo', path: '.', maxResults: 100 });

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('-m');
			expect(spawnArgs).toContain('100');
		});
	});

	describe('no matches (exit code 1)', () => {
		it('returns "No matches found." when exit code is 1 and stdout is empty', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 1 }));

			const result = await gadget.execute({ comment: 'test', pattern: 'nothinghere', path: '.' });

			expect(result).toBe('No matches found.');
		});

		it('returns stdout output even when exit code is 1', async () => {
			// rg exits 1 when it finds no matches; any stdout would be unusual but handle it
			mockSpawn.mockReturnValue(makeProcess({ stdout: 'some:output\n', exitCode: 1 }));

			const result = await gadget.execute({ comment: 'test', pattern: 'foo', path: '.' });

			expect(result).toBe('some:output\n');
		});
	});

	describe('error handling', () => {
		it('returns error message with stderr when exit code > 1', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stderr: 'rg: invalid argument', exitCode: 2 }));

			const result = await gadget.execute({ comment: 'test', pattern: 'foo', path: '.' });

			expect(result).toContain('ripgrep error');
			expect(result).toContain('code 2');
			expect(result).toContain('rg: invalid argument');
		});

		it('returns fallback error message when stderr is empty and exit code > 1', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stderr: '', exitCode: 3 }));

			const result = await gadget.execute({ comment: 'test', pattern: 'foo', path: '.' });

			expect(result).toContain('Unknown error');
		});

		it('returns helpful message when spawn emits an error event', async () => {
			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			process.nextTick(() => {
				proc.emit('error', new Error('spawn ENOENT'));
			});

			mockSpawn.mockReturnValue(proc);

			const result = await gadget.execute({ comment: 'test', pattern: 'foo', path: '.' });

			expect(result).toContain('Failed to run ripgrep');
			expect(result).toContain('spawn ENOENT');
		});
	});

	describe('invocation', () => {
		it('invokes rg as the command', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({ comment: 'test', pattern: 'pattern', path: '.' });

			expect(mockSpawn).toHaveBeenCalledWith('rg', expect.any(Array));
		});
	});
});
