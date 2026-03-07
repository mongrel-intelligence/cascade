import { describe, expect, it } from 'vitest';
import { validateGitCommand } from '../../../../src/gadgets/tmux/gitValidation.js';

describe('validateGitCommand', () => {
	describe('blocks git commit with --no-verify', () => {
		it('blocks basic --no-verify', () => {
			expect(() => validateGitCommand('git commit --no-verify -m "test"')).toThrow('--no-verify');
		});

		it('blocks --no-verify before message', () => {
			expect(() => validateGitCommand('git commit --no-verify -m "message"')).toThrow(
				'--no-verify',
			);
		});

		it('blocks --no-verify after message', () => {
			expect(() => validateGitCommand('git commit -m "message" --no-verify')).toThrow(
				'--no-verify',
			);
		});

		it('blocks --no-verify with --amend', () => {
			expect(() => validateGitCommand('git commit --amend --no-verify')).toThrow('--no-verify');
		});
	});

	describe('blocks git commit with -n flag variants', () => {
		it('blocks standalone -n', () => {
			expect(() => validateGitCommand('git commit -n -m "test"')).toThrow('--no-verify');
		});

		it('blocks combined flags -anm (flag containing n)', () => {
			expect(() => validateGitCommand('git commit -anm "test"')).toThrow('--no-verify');
		});

		it('blocks combined flags -nam', () => {
			expect(() => validateGitCommand('git commit -nam "test"')).toThrow('--no-verify');
		});

		it('blocks combined flags -mn', () => {
			expect(() => validateGitCommand('git commit -mn "test"')).toThrow('--no-verify');
		});
	});

	describe('blocks git push with --no-verify', () => {
		it('blocks basic --no-verify', () => {
			expect(() => validateGitCommand('git push --no-verify')).toThrow('--no-verify');
		});

		it('blocks --no-verify with remote and branch', () => {
			expect(() => validateGitCommand('git push origin main --no-verify')).toThrow('--no-verify');
		});

		it('blocks --no-verify before remote', () => {
			expect(() => validateGitCommand('git push --no-verify origin main')).toThrow('--no-verify');
		});
	});

	describe('blocks git push with -n flag variants', () => {
		it('blocks standalone -n', () => {
			expect(() => validateGitCommand('git push -n')).toThrow('--no-verify');
		});

		it('blocks combined flags -fn', () => {
			expect(() => validateGitCommand('git push -fn origin main')).toThrow('--no-verify');
		});
	});

	describe('blocks broad git staging commands', () => {
		it('blocks git add -A', () => {
			expect(() => validateGitCommand('git add -A')).toThrow('Broad git staging');
		});

		it('blocks git add --all', () => {
			expect(() => validateGitCommand('git add --all')).toThrow('Broad git staging');
		});

		it('blocks git add .', () => {
			expect(() => validateGitCommand('git add .')).toThrow('Broad git staging');
		});

		it('blocks git add . in a chain with &&', () => {
			expect(() => validateGitCommand('git add . && git commit -m "test"')).toThrow(
				'Broad git staging',
			);
		});

		it('blocks git add -A in a chain with &&', () => {
			expect(() => validateGitCommand('git add -A && git commit -m "test"')).toThrow(
				'Broad git staging',
			);
		});

		it('blocks git add ./ (with trailing slash)', () => {
			expect(() => validateGitCommand('git add ./')).toThrow('Broad git staging');
		});
	});

	describe('allows normal git commands', () => {
		it('allows git commit with message', () => {
			expect(() => validateGitCommand('git commit -m "test message"')).not.toThrow();
		});

		it('allows git commit --amend without --no-verify', () => {
			expect(() => validateGitCommand('git commit --amend -m "fix"')).not.toThrow();
		});

		it('allows git commit with verbose flag', () => {
			expect(() => validateGitCommand('git commit -v -m "test"')).not.toThrow();
		});

		it('allows git add with specific files', () => {
			expect(() => validateGitCommand('git add src/file.ts')).not.toThrow();
		});

		it('allows git add with multiple specific files', () => {
			expect(() => validateGitCommand('git add src/index.ts src/app.ts')).not.toThrow();
		});

		it('allows git add -N (intent-to-add, uppercase N is not blocked)', () => {
			// uppercase N is not -n; after lowercasing the regex checks for lowercase n
			// but -N becomes -n after normalization — this is allowed because git add -n is dry-run
			expect(() => validateGitCommand('git add -N src/newfile.ts')).not.toThrow();
		});

		it('allows git add -u (tracked files only)', () => {
			expect(() => validateGitCommand('git add -u')).not.toThrow();
		});

		it('allows git add -p (patch mode)', () => {
			expect(() => validateGitCommand('git add -p')).not.toThrow();
		});

		it('allows normal git push', () => {
			expect(() => validateGitCommand('git push origin main')).not.toThrow();
		});

		it('allows git push -f (force without no-verify)', () => {
			expect(() => validateGitCommand('git push -f origin main')).not.toThrow();
		});

		it('allows git push -u (set upstream)', () => {
			expect(() => validateGitCommand('git push -u origin feature')).not.toThrow();
		});

		it('allows non-git commands', () => {
			expect(() => validateGitCommand('npm test')).not.toThrow();
			expect(() => validateGitCommand('echo "hello"')).not.toThrow();
		});

		it('allows git log -n (limit, not no-verify)', () => {
			expect(() => validateGitCommand('git log -n 10')).not.toThrow();
		});
	});

	describe('handles edge cases', () => {
		it('is case insensitive', () => {
			expect(() => validateGitCommand('GIT COMMIT --NO-VERIFY -m "test"')).toThrow('--no-verify');
		});

		it('handles extra whitespace', () => {
			expect(() => validateGitCommand('git   commit   --no-verify')).toThrow('--no-verify');
		});

		it('blocks after pipe operator', () => {
			expect(() => validateGitCommand('echo test | git commit --no-verify')).toThrow('--no-verify');
		});

		it('blocks after semicolon', () => {
			expect(() => validateGitCommand('echo test; git commit --no-verify')).toThrow('--no-verify');
		});

		it('blocks after && operator', () => {
			expect(() => validateGitCommand('npm test && git commit --no-verify')).toThrow('--no-verify');
		});

		it('allows git commit before pipe without --no-verify', () => {
			expect(() => validateGitCommand('git commit -m "test" | cat')).not.toThrow();
		});
	});
});
