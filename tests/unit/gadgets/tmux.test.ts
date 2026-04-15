import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	sanitizeSessionName,
	sleep,
	stripAnsi,
	unescapeOutput,
} from '../../../src/gadgets/tmux/utils.js';
import {
	consumePendingSessionNotices,
	resolveWorkingDirectory,
	Tmux,
	validateGitCommand,
} from '../../../src/gadgets/tmux.js';

describe('Tmux Gadget', () => {
	describe('resolveWorkingDirectory', () => {
		it('resolves "." to process.cwd()', () => {
			expect(resolveWorkingDirectory('.')).toBe(process.cwd());
		});

		it('resolves relative path against process.cwd()', () => {
			expect(resolveWorkingDirectory('apps/frontend')).toBe(
				resolve(process.cwd(), 'apps/frontend'),
			);
		});

		it('leaves absolute paths unchanged', () => {
			expect(resolveWorkingDirectory('/absolute/path')).toBe('/absolute/path');
		});

		it('defaults to process.cwd() when cwd is undefined', () => {
			expect(resolveWorkingDirectory(undefined)).toBe(process.cwd());
		});
	});

	describe('Tmux class', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new Tmux();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new Tmux();
			expect(gadget.name).toBe('Tmux');
			expect(gadget.description).toContain('tmux');
		});
	});

	describe('sanitizeSessionName', () => {
		it('passes through valid names unchanged', () => {
			expect(sanitizeSessionName('test-run')).toBe('test-run');
			expect(sanitizeSessionName('my_session')).toBe('my_session');
			expect(sanitizeSessionName('Run123')).toBe('Run123');
		});

		it('replaces slashes with dashes', () => {
			expect(sanitizeSessionName('feat/my-branch')).toBe('feat-my-branch');
		});

		it('replaces spaces and special characters', () => {
			expect(sanitizeSessionName('my session!')).toBe('my-session-');
			expect(sanitizeSessionName('a@b#c$d')).toBe('a-b-c-d');
		});

		it('replaces dots with dashes', () => {
			expect(sanitizeSessionName('file.test')).toBe('file-test');
		});
	});

	describe('unescapeOutput', () => {
		it('converts octal newline escape to actual newline', () => {
			expect(unescapeOutput('hello\\012world')).toBe('hello\nworld');
		});

		it('converts octal tab escape', () => {
			expect(unescapeOutput('col1\\011col2')).toBe('col1\tcol2');
		});

		it('leaves strings without escapes unchanged', () => {
			expect(unescapeOutput('plain text')).toBe('plain text');
		});

		it('handles multiple octal escapes', () => {
			expect(unescapeOutput('a\\012b\\012c')).toBe('a\nb\nc');
		});
	});

	describe('stripAnsi', () => {
		it('strips CSI sequences (colors, bold, etc.)', () => {
			expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
			expect(stripAnsi('\u001b[1;32mbold green\u001b[0m')).toBe('bold green');
		});

		it('strips OSC sequences (title sets, hyperlinks)', () => {
			expect(stripAnsi('\u001b]0;window title\u0007rest')).toBe('rest');
		});

		it('strips DCS sequences', () => {
			expect(stripAnsi('\u001bPsome data\u001b\\rest')).toBe('rest');
		});

		it('removes carriage returns', () => {
			expect(stripAnsi('line1\r\nline2')).toBe('line1\nline2');
		});

		it('leaves plain text unchanged', () => {
			expect(stripAnsi('no escape codes here')).toBe('no escape codes here');
		});

		it('handles mixed ANSI and plain text', () => {
			expect(stripAnsi('before \u001b[32mgreen\u001b[0m after')).toBe('before green after');
		});
	});

	describe('sleep', () => {
		it('resolves after the specified delay', async () => {
			vi.useFakeTimers();
			const promise = sleep(100);
			vi.advanceTimersByTime(100);
			await expect(promise).resolves.toBeUndefined();
			vi.useRealTimers();
		});
	});

	describe('backward-compat shim re-exports', () => {
		it('Tmux is importable from the shim path', () => {
			expect(Tmux).toBeDefined();
		});

		it('consumePendingSessionNotices is importable from the shim path', () => {
			expect(typeof consumePendingSessionNotices).toBe('function');
		});

		it('validateGitCommand is importable from the shim path', () => {
			expect(typeof validateGitCommand).toBe('function');
		});

		it('resolveWorkingDirectory is importable from the shim path', () => {
			expect(typeof resolveWorkingDirectory).toBe('function');
		});
	});
});
