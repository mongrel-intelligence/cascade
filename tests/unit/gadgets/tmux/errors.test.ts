import { describe, expect, it } from 'vitest';
import { CommandFailedError } from '../../../../src/gadgets/tmux/errors.js';

describe('CommandFailedError', () => {
	describe('stores properties', () => {
		it('stores session property', () => {
			const err = new CommandFailedError('my-session', 1, 'output');
			expect(err.session).toBe('my-session');
		});

		it('stores exitCode property', () => {
			const err = new CommandFailedError('session', 42, 'output');
			expect(err.exitCode).toBe(42);
		});

		it('stores output property (full original output, not truncated)', () => {
			const longOutput = 'x'.repeat(2000);
			const err = new CommandFailedError('session', 1, longOutput);
			expect(err.output).toBe(longOutput);
			expect(err.output.length).toBe(2000);
		});

		it('stores all three properties together', () => {
			const err = new CommandFailedError('test-session', 127, 'command not found');
			expect(err.session).toBe('test-session');
			expect(err.exitCode).toBe(127);
			expect(err.output).toBe('command not found');
		});
	});

	describe('error name', () => {
		it('has name "CommandFailedError"', () => {
			const err = new CommandFailedError('s', 1, '');
			expect(err.name).toBe('CommandFailedError');
		});
	});

	describe('error message', () => {
		it('includes exit code in message', () => {
			const err = new CommandFailedError('session', 127, 'output');
			expect(err.message).toContain('127');
		});

		it('includes session name in message', () => {
			const err = new CommandFailedError('my-session', 1, 'output');
			expect(err.message).toContain('my-session');
		});

		it('includes formatted Session and Exit code labels', () => {
			const err = new CommandFailedError('my-cmd', 127, 'command not found');
			expect(err.message).toContain('Session: my-cmd');
			expect(err.message).toContain('Exit code: 127');
			expect(err.message).toContain('command not found');
		});

		it('includes short output in full', () => {
			const err = new CommandFailedError('session', 1, 'short output text');
			expect(err.message).toContain('short output text');
		});

		it('truncates long output (>1000 chars) to last 1000 chars in message', () => {
			// Build output where last 1000 chars are 'y' and first 1000 are 'x'
			const longOutput = 'x'.repeat(1000) + 'y'.repeat(1000);
			const err = new CommandFailedError('session', 1, longOutput);
			expect(err.message).toContain('y'.repeat(1000));
			expect(err.message).not.toContain('x'.repeat(1000));
		});

		it('uses last 1000 chars exactly when output is longer than 1000', () => {
			const longOutput = 'a'.repeat(2000);
			const err = new CommandFailedError('s', 1, longOutput);
			// Message should contain 1000 a's but not 1001
			expect(err.message).toContain('a'.repeat(1000));
			// The preview is exactly the last 1000 chars (all 'a')
			const outputSection = err.message.split('Output:\n')[1];
			expect(outputSection?.length).toBe(1000);
		});

		it('shows "(no output)" for empty output', () => {
			const err = new CommandFailedError('session', 1, '');
			expect(err.message).toContain('(no output)');
		});
	});

	describe('inheritance', () => {
		it('is an instance of Error', () => {
			const err = new CommandFailedError('s', 1, 'out');
			expect(err).toBeInstanceOf(Error);
		});

		it('is an instance of CommandFailedError', () => {
			const err = new CommandFailedError('s', 1, 'out');
			expect(err).toBeInstanceOf(CommandFailedError);
		});
	});
});
