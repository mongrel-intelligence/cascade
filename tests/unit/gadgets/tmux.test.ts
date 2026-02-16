import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	Tmux,
	consumePendingSessionNotices,
	resolveWorkingDirectory,
	validateGitCommand,
} from '../../../src/gadgets/tmux.js';
import { CommandFailedError } from '../../../src/gadgets/tmux/errors.js';
import { addPendingNotice } from '../../../src/gadgets/tmux/sessionNotices.js';
import {
	sanitizeSessionName,
	sleep,
	stripAnsi,
	unescapeOutput,
} from '../../../src/gadgets/tmux/utils.js';

describe('Tmux Gadget', () => {
	describe('validateGitCommand', () => {
		describe('should reject git commit with --no-verify', () => {
			it('basic --no-verify', () => {
				expect(() => validateGitCommand('git commit --no-verify -m "test"')).toThrow('--no-verify');
			});

			it('--no-verify before message', () => {
				expect(() => validateGitCommand('git commit --no-verify -m "message"')).toThrow(
					'--no-verify',
				);
			});

			it('--no-verify after message', () => {
				expect(() => validateGitCommand('git commit -m "message" --no-verify')).toThrow(
					'--no-verify',
				);
			});

			it('with amend and --no-verify', () => {
				expect(() => validateGitCommand('git commit --amend --no-verify')).toThrow('--no-verify');
			});
		});

		describe('should reject git commit with -n flag', () => {
			it('standalone -n', () => {
				expect(() => validateGitCommand('git commit -n -m "test"')).toThrow('--no-verify');
			});

			it('combined flags -anm', () => {
				expect(() => validateGitCommand('git commit -anm "test"')).toThrow('--no-verify');
			});

			it('combined flags -nam', () => {
				expect(() => validateGitCommand('git commit -nam "test"')).toThrow('--no-verify');
			});

			it('combined flags -mn', () => {
				expect(() => validateGitCommand('git commit -mn "test"')).toThrow('--no-verify');
			});
		});

		describe('should reject git push with --no-verify', () => {
			it('basic --no-verify', () => {
				expect(() => validateGitCommand('git push --no-verify')).toThrow('--no-verify');
			});

			it('with remote and branch', () => {
				expect(() => validateGitCommand('git push origin main --no-verify')).toThrow('--no-verify');
			});

			it('--no-verify before remote', () => {
				expect(() => validateGitCommand('git push --no-verify origin main')).toThrow('--no-verify');
			});
		});

		describe('should reject git push with -n flag', () => {
			it('standalone -n', () => {
				expect(() => validateGitCommand('git push -n')).toThrow('--no-verify');
			});

			it('combined flags', () => {
				expect(() => validateGitCommand('git push -fn origin main')).toThrow('--no-verify');
			});
		});

		describe('should reject broad git staging commands', () => {
			it('git add -A', () => {
				expect(() => validateGitCommand('git add -A')).toThrow('Broad git staging');
			});

			it('git add --all', () => {
				expect(() => validateGitCommand('git add --all')).toThrow('Broad git staging');
			});

			it('git add .', () => {
				expect(() => validateGitCommand('git add .')).toThrow('Broad git staging');
			});

			it('git add . in a chain', () => {
				expect(() => validateGitCommand('git add . && git commit -m "test"')).toThrow(
					'Broad git staging',
				);
			});

			it('git add -A in a chain', () => {
				expect(() => validateGitCommand('git add -A && git commit -m "test"')).toThrow(
					'Broad git staging',
				);
			});

			it('git add ./ (with trailing slash)', () => {
				expect(() => validateGitCommand('git add ./')).toThrow('Broad git staging');
			});

			it('allows git add with specific files', () => {
				expect(() => validateGitCommand('git add src/index.ts src/app.ts')).not.toThrow();
			});

			it('allows git add -u (tracked files only)', () => {
				expect(() => validateGitCommand('git add -u')).not.toThrow();
			});

			it('allows git add -p (patch mode)', () => {
				expect(() => validateGitCommand('git add -p')).not.toThrow();
			});
		});

		describe('should allow normal git commands', () => {
			it('normal git commit', () => {
				expect(() => validateGitCommand('git commit -m "test message"')).not.toThrow();
			});

			it('git commit with all flag', () => {
				expect(() => validateGitCommand('git commit -am "test message"')).not.toThrow();
			});

			it('git commit with verbose', () => {
				expect(() => validateGitCommand('git commit -v -m "test"')).not.toThrow();
			});

			it('normal git push', () => {
				expect(() => validateGitCommand('git push origin main')).not.toThrow();
			});

			it('git push with force', () => {
				expect(() => validateGitCommand('git push -f origin main')).not.toThrow();
			});

			it('git push with upstream', () => {
				expect(() => validateGitCommand('git push -u origin feature')).not.toThrow();
			});

			it('non-git commands', () => {
				expect(() => validateGitCommand('npm test')).not.toThrow();
				expect(() => validateGitCommand('echo "hello"')).not.toThrow();
			});
		});

		describe('should handle edge cases', () => {
			it('case insensitive', () => {
				expect(() => validateGitCommand('GIT COMMIT --NO-VERIFY -m "test"')).toThrow('--no-verify');
			});

			it('extra whitespace', () => {
				expect(() => validateGitCommand('git   commit   --no-verify')).toThrow('--no-verify');
			});

			it('should still block after pipe', () => {
				// Commands after | will still be executed
				expect(() => validateGitCommand('echo test | git commit --no-verify')).toThrow(
					'--no-verify',
				);
			});

			it('should still block after semicolon', () => {
				// Commands after ; will still be executed
				expect(() => validateGitCommand('echo test; git commit --no-verify')).toThrow(
					'--no-verify',
				);
			});

			it('should still block after &&', () => {
				// Commands after && will still be executed (if first succeeds)
				expect(() => validateGitCommand('npm test && git commit --no-verify')).toThrow(
					'--no-verify',
				);
			});

			it('allows git commit before pipe without --no-verify', () => {
				// git commit without --no-verify followed by pipe is OK
				expect(() => validateGitCommand('git commit -m "test" | cat')).not.toThrow();
			});

			it('git add -n is allowed (dry-run, not no-verify)', () => {
				// git add -n is --dry-run, not --no-verify
				expect(() => validateGitCommand('git add -n .')).not.toThrow();
			});

			it('git status with -n argument should be allowed', () => {
				expect(() => validateGitCommand('git status')).not.toThrow();
			});

			it('git log -n is allowed', () => {
				expect(() => validateGitCommand('git log -n 10')).not.toThrow();
			});
		});
	});

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

	describe('CommandFailedError', () => {
		it('stores session, exitCode, and output', () => {
			const err = new CommandFailedError('test-session', 1, 'some output');
			expect(err.session).toBe('test-session');
			expect(err.exitCode).toBe(1);
			expect(err.output).toBe('some output');
		});

		it('has correct name', () => {
			const err = new CommandFailedError('s', 1, '');
			expect(err.name).toBe('CommandFailedError');
		});

		it('includes session and exit code in message', () => {
			const err = new CommandFailedError('my-cmd', 127, 'command not found');
			expect(err.message).toContain('Session: my-cmd');
			expect(err.message).toContain('Exit code: 127');
			expect(err.message).toContain('command not found');
		});

		it('truncates long output to last 1000 chars', () => {
			const longOutput = 'x'.repeat(2000);
			const err = new CommandFailedError('s', 1, longOutput);
			// Preview should be the last 1000 chars
			expect(err.message).toContain('x'.repeat(1000));
			expect(err.message).not.toContain('x'.repeat(1001));
		});

		it('shows "(no output)" for empty output', () => {
			const err = new CommandFailedError('s', 1, '');
			expect(err.message).toContain('(no output)');
		});

		it('is an instance of Error', () => {
			const err = new CommandFailedError('s', 1, 'out');
			expect(err).toBeInstanceOf(Error);
		});
	});

	describe('sessionNotices', () => {
		afterEach(() => {
			// Drain any leftover notices from previous tests
			consumePendingSessionNotices();
		});

		it('addPendingNotice + consumePendingSessionNotices round-trip', () => {
			addPendingNotice('sess-1', { exitCode: 0, tailOutput: 'all good' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(1);
			expect(notices.get('sess-1')).toEqual({ exitCode: 0, tailOutput: 'all good' });
		});

		it('consume clears the pending notices', () => {
			addPendingNotice('sess-2', { exitCode: 1, tailOutput: 'fail' });

			consumePendingSessionNotices(); // first consume
			const second = consumePendingSessionNotices(); // should be empty
			expect(second.size).toBe(0);
		});

		it('handles multiple notices', () => {
			addPendingNotice('a', { exitCode: 0, tailOutput: 'output-a' });
			addPendingNotice('b', { exitCode: 1, tailOutput: 'output-b' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(2);
			expect(notices.get('a')?.exitCode).toBe(0);
			expect(notices.get('b')?.exitCode).toBe(1);
		});

		it('later notice for same session overwrites earlier one', () => {
			addPendingNotice('dup', { exitCode: 0, tailOutput: 'first' });
			addPendingNotice('dup', { exitCode: 1, tailOutput: 'second' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(1);
			expect(notices.get('dup')).toEqual({ exitCode: 1, tailOutput: 'second' });
		});

		it('consumePendingSessionNotices returns empty map when nothing pending', () => {
			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(0);
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
