/**
 * Validates that git commands don't contain dangerous flags that bypass safety checks.
 * @throws Error if a dangerous flag is detected
 */
export function validateGitCommand(command: string): void {
	// Normalize command for checking (handle multiline, extra spaces)
	const normalized = command.toLowerCase();

	// Check for git commit/push with --no-verify or -n flag
	// Match patterns like: git commit --no-verify, git push --no-verify
	// Also match: git commit -n, git commit -anm (contains -n)
	// Uses .*? (non-greedy) to match any characters between git commit/push and the flag
	// The -n pattern matches any flag containing 'n' (e.g., -n, -an, -anm, -nam)
	const gitNoVerifyPattern =
		/\bgit\s+(commit|push)\b.*?(\s--no-verify\b|\s-[a-z]*n[a-z]*(?=\s|"|'|$))/;

	if (gitNoVerifyPattern.test(normalized)) {
		throw new Error(
			'Git commands with --no-verify or -n flag are not allowed. ' +
				'Pre-commit and pre-push hooks must run to ensure code quality.',
		);
	}

	// Block broad staging commands that capture unintended files (build artifacts, generated files)
	// Note: normalized is already lowercased, so -A becomes -a
	const broadStagingPattern =
		/\bgit\s+add\s+(-a\b|--all\b|\.\s*($|&&|\||;|"|')|\.\/\s*($|&&|\||;|"|'))/;
	if (broadStagingPattern.test(normalized)) {
		throw new Error(
			'Broad git staging (git add -A / git add . / git add --all) is not allowed. ' +
				'Stage specific files instead: git add <file1> <file2> ...\n' +
				'This prevents accidentally committing build artifacts and generated files.',
		);
	}
}
