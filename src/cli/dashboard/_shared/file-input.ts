import { readFileSync } from 'node:fs';

/**
 * Read operator-supplied Dockerfile content from a file path, or from stdin when
 * the path is `-`. Follows the `readFileInput` precedent in
 * `src/gadgets/shared/cli/params.ts` so a multi-line Dockerfile block never has
 * to be shell-escaped on the command line.
 *
 * Shared by `projects create` and `projects update` (`--dockerfile-file`) so the
 * read semantics stay identical between the two commands (spec 023).
 */
export function readDockerfileInput(pathOrDash: string): string {
	return pathOrDash === '-' ? readFileSync(0, 'utf-8') : readFileSync(pathOrDash, 'utf-8');
}
