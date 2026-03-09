import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — spawn mock variable initialized before vi.mock factories
// ---------------------------------------------------------------------------

const { mockSpawn } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
}));

// Mock child_process.spawn so no real sg binary is required
vi.mock('node:child_process', () => ({
	spawn: mockSpawn,
}));

// Mock pathValidation to allow any path in tests
vi.mock('../../../src/gadgets/shared/pathValidation.js', () => ({
	validatePath: vi.fn((path: string) => path),
}));

// Mock sessionState for readOnlyFs checks
vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(() => ({ readOnlyFs: false })),
}));

// Mock readTracking so assertFileRead is a no-op
vi.mock('../../../src/gadgets/readTracking.js', () => ({
	assertFileRead: vi.fn(),
	markFileRead: vi.fn(),
	hasReadFile: vi.fn().mockReturnValue(true),
	clearReadTracking: vi.fn(),
	invalidateFileRead: vi.fn(),
	hasListedDirectory: vi.fn().mockReturnValue(false),
	markDirectoryListed: vi.fn(),
}));

// Mock post-edit checks to avoid running tsc/biome
vi.mock('../../../src/gadgets/shared/postEditChecks.js', () => ({
	runPostEditChecks: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AstGrep } from '../../../src/gadgets/AstGrep.js';
import { assertFileRead } from '../../../src/gadgets/readTracking.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { validatePath } from '../../../src/gadgets/shared/pathValidation.js';
import { runPostEditChecks } from '../../../src/gadgets/shared/postEditChecks.js';

const mockGetSessionState = vi.mocked(getSessionState);

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
// Test setup
// ---------------------------------------------------------------------------

let gadget: AstGrep;
let tmpDir: string;

beforeEach(() => {
	gadget = new AstGrep();
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-test-astgrep-'));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.clearAllMocks();
});

function createFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AstGrep', () => {
	describe('search mode (no rewrite)', () => {
		it('returns matching lines from sg stdout', async () => {
			const output = 'src/utils.ts:15:  console.log(error)\n';
			mockSpawn.mockReturnValue(makeProcess({ stdout: output, exitCode: 0 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: 'src/',
			});

			expect(result).toBe(output);
		});

		it('returns "No matches found." when exit code is 0 and stdout is empty', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: 'src/',
			});

			expect(result).toBe('No matches found.');
		});

		it('returns "No matches found." when exit code is 1', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 1 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: 'src/',
			});

			expect(result).toBe('No matches found.');
		});

		it('passes correct arguments to sg for search', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({
				comment: 'test',
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: 'src/',
			});

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('run');
			expect(spawnArgs).toContain('--pattern');
			expect(spawnArgs).toContain('console.log($MSG)');
			expect(spawnArgs).toContain('--lang');
			expect(spawnArgs).toContain('typescript');
			expect(spawnArgs).toContain('--color=never');
			expect(spawnArgs).toContain('src/');
		});

		it('invokes sg as the command for search', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stdout: '', exitCode: 0 }));

			await gadget.execute({
				comment: 'test',
				pattern: 'foo($X)',
				language: 'javascript',
				path: '.',
			});

			expect(mockSpawn).toHaveBeenCalledWith('sg', expect.any(Array));
		});
	});

	describe('search mode — error handling', () => {
		it('returns error message with exit code and stderr when code > 1', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stderr: 'sg: unsupported language', exitCode: 2 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo',
				language: 'typescript',
				path: '.',
			});

			expect(result).toContain('ast-grep error');
			expect(result).toContain('code 2');
			expect(result).toContain('sg: unsupported language');
		});

		it('returns fallback error message when stderr is empty and code > 1', async () => {
			mockSpawn.mockReturnValue(makeProcess({ stderr: '', exitCode: 5 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo',
				language: 'typescript',
				path: '.',
			});

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

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo',
				language: 'typescript',
				path: '.',
			});

			expect(result).toContain('Failed to run ast-grep');
			expect(result).toContain('spawn ENOENT');
		});
	});

	describe('rewrite mode', () => {
		it('builds diff output and runs postEditChecks after successful rewrite', async () => {
			const filePath = createFile('example.ts', 'console.log(error)\n');

			// After the rewrite, sg will have modified the file on disk.
			// We simulate this by writing the "after" content before the close event fires.
			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			process.nextTick(() => {
				// Simulate sg rewriting the file
				writeFileSync(filePath, 'logger.debug(error)\n', 'utf-8');
				proc.emit('close', 0);
			});

			mockSpawn.mockReturnValue(proc);

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: filePath,
				rewrite: 'logger.debug($MSG)',
			});

			// Should contain diff lines
			expect(result).toContain('console.log(error)');
			expect(result).toContain('logger.debug(error)');
			// Should contain status
			expect(result).toContain('status=success');
			// postEditChecks should have been called
			expect(runPostEditChecks).toHaveBeenCalled();
		});

		it('calls assertFileRead before performing the rewrite', async () => {
			const filePath = createFile('example.ts', 'const x = foo();\n');

			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			process.nextTick(() => {
				proc.emit('close', 0);
			});

			mockSpawn.mockReturnValue(proc);

			await gadget.execute({
				comment: 'test',
				pattern: 'foo()',
				language: 'typescript',
				path: filePath,
				rewrite: 'bar()',
			});

			expect(assertFileRead).toHaveBeenCalledWith(filePath, 'AstGrep');
		});

		it('returns no_change status when the file content is unchanged after rewrite', async () => {
			const filePath = createFile('example.ts', 'const x = 1;\n');

			// sg runs but does NOT modify the file (no pattern match)
			mockSpawn.mockReturnValue(makeProcess({ exitCode: 0 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo()',
				language: 'typescript',
				path: filePath,
				rewrite: 'bar()',
			});

			expect(result).toContain('status=no_change');
		});

		it('passes --rewrite and --update-all flags in rewrite mode', async () => {
			const filePath = createFile('example.ts', 'const x = foo();\n');

			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			process.nextTick(() => {
				proc.emit('close', 0);
			});

			mockSpawn.mockReturnValue(proc);

			await gadget.execute({
				comment: 'test',
				pattern: 'foo()',
				language: 'typescript',
				path: filePath,
				rewrite: 'bar()',
			});

			const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
			expect(spawnArgs).toContain('--rewrite');
			expect(spawnArgs).toContain('bar()');
			expect(spawnArgs).toContain('--update-all');
		});

		it('returns error message when sg exits with non-zero code during rewrite', async () => {
			const filePath = createFile('example.ts', 'const x = foo();\n');

			mockSpawn.mockReturnValue(makeProcess({ stderr: 'parse error', exitCode: 3 }));

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo(',
				language: 'typescript',
				path: filePath,
				rewrite: 'bar(',
			});

			expect(result).toContain('ast-grep error');
			expect(result).toContain('code 3');
		});

		it('blocks rewrite when session is read-only', async () => {
			mockGetSessionState.mockReturnValueOnce({ readOnlyFs: true } as never);
			const filePath = createFile('example.ts', 'const x = foo();\n');

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'foo()',
				language: 'typescript',
				path: filePath,
				rewrite: 'bar()',
			});

			expect(result).toContain('not available for read-only agents');
			expect(mockSpawn).not.toHaveBeenCalled();
		});

		it('includes diagnostic error status when postEditChecks reports errors', async () => {
			const filePath = createFile('example.ts', 'const x: string = 1;\n');

			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			process.nextTick(() => {
				writeFileSync(filePath, 'const x: number = 1;\n', 'utf-8');
				proc.emit('close', 0);
			});

			mockSpawn.mockReturnValue(proc);

			vi.mocked(runPostEditChecks).mockReturnValueOnce({
				hasErrors: true,
				statusMessage: '## Diagnostics\n\nErrors found.',
				fileResults: [],
			});

			const result = await gadget.execute({
				comment: 'test',
				pattern: 'const x: string = $V',
				language: 'typescript',
				path: filePath,
				rewrite: 'const x: number = $V',
			});

			expect(result).toContain('status=error');
		});
	});
});
