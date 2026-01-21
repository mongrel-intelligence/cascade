import { describe, expect, it } from 'vitest';
import { Tmux, validateGitCommand } from '../../../src/gadgets/tmux.js';

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
});
