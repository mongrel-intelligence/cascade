import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so the mock factory can reference these variables
const { mockRlClose, mockRlQuestion, mockRlInstance, mockCreateInterface } = vi.hoisted(() => {
	const mockRlClose = vi.fn();
	const mockRlQuestion = vi.fn();
	const mockRlInstance = {
		question: mockRlQuestion,
		close: mockRlClose,
	};
	const mockCreateInterface = vi.fn().mockReturnValue(mockRlInstance);
	return { mockRlClose, mockRlQuestion, mockRlInstance, mockCreateInterface };
});

vi.mock('node:readline', () => ({
	createInterface: (...args: unknown[]) => mockCreateInterface(...args),
	default: {
		createInterface: (...args: unknown[]) => mockCreateInterface(...args),
	},
}));

import { confirm } from '../../../../src/cli/dashboard/_shared/confirm.js';

describe('confirm', () => {
	let originalIsTTY: boolean | undefined;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Save original isTTY so we can restore it after each test
		originalIsTTY = process.stdin.isTTY;

		// Spy on process.exit so we can assert it was called without actually exiting
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
			throw new Error(`process.exit(${_code})`);
		});

		// Spy on stdout.write to capture "Cancelled." messages
		stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		mockCreateInterface.mockClear();
		mockCreateInterface.mockReturnValue(mockRlInstance);
		mockRlQuestion.mockClear();
		mockRlClose.mockClear();
	});

	afterEach(() => {
		// Restore isTTY
		Object.defineProperty(process.stdin, 'isTTY', {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// --yes flag bypass
	// -----------------------------------------------------------------------
	describe('yes flag bypass', () => {
		it('auto-accepts without prompting when skipFlag is true', async () => {
			await expect(confirm('Delete project foo?', true)).resolves.toBeUndefined();
			expect(mockCreateInterface).not.toHaveBeenCalled();
		});

		it('auto-accepts regardless of stdin.isTTY when skipFlag is true', async () => {
			Object.defineProperty(process.stdin, 'isTTY', {
				value: true,
				writable: true,
				configurable: true,
			});
			await expect(confirm('Delete project foo?', true)).resolves.toBeUndefined();
			expect(mockCreateInterface).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Non-TTY (piped/CI) auto-accept
	// -----------------------------------------------------------------------
	describe('non-TTY auto-accept', () => {
		it('auto-accepts when stdin.isTTY is undefined (piped)', async () => {
			Object.defineProperty(process.stdin, 'isTTY', {
				value: undefined,
				writable: true,
				configurable: true,
			});
			await expect(confirm('Delete project foo?', false)).resolves.toBeUndefined();
			expect(mockCreateInterface).not.toHaveBeenCalled();
		});

		it('auto-accepts when stdin.isTTY is false', async () => {
			Object.defineProperty(process.stdin, 'isTTY', {
				value: false,
				writable: true,
				configurable: true,
			});
			await expect(confirm('Delete project foo?', false)).resolves.toBeUndefined();
			expect(mockCreateInterface).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// TTY prompt — interactive
	// -----------------------------------------------------------------------
	describe('TTY interactive prompt', () => {
		beforeEach(() => {
			Object.defineProperty(process.stdin, 'isTTY', {
				value: true,
				writable: true,
				configurable: true,
			});
		});

		it('resolves when user answers "y"', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('y');
			});

			await expect(confirm('Delete project foo?', false)).resolves.toBeUndefined();
		});

		it('resolves when user answers "Y" (case-insensitive)', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('Y');
			});

			await expect(confirm('Delete project foo?', false)).resolves.toBeUndefined();
		});

		it('exits with code 1 when user answers "n"', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('n');
			});

			await expect(confirm('Delete project foo?', false)).rejects.toThrow('process.exit(1)');
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(stdoutSpy).toHaveBeenCalledWith('Cancelled.\n');
		});

		it('exits with code 1 when user answers empty string', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('');
			});

			await expect(confirm('Delete project foo?', false)).rejects.toThrow('process.exit(1)');
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it('exits with code 1 when user answers non-y input', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('no');
			});

			await expect(confirm('Delete some resource?', false)).rejects.toThrow('process.exit(1)');
		});

		it('includes the message and [y/N] in the prompt', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('y');
			});

			await confirm('Delete project my-project?', false);

			expect(mockRlQuestion).toHaveBeenCalledWith(
				'Delete project my-project? [y/N]: ',
				expect.any(Function),
			);
		});

		it('closes the readline interface after the answer', async () => {
			mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
				cb('y');
			});

			await confirm('Delete project foo?', false);

			expect(mockRlClose).toHaveBeenCalled();
		});
	});
});
