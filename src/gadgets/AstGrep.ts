import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Gadget, z } from 'llmist';

import { assertFileRead, markFileRead } from './readTracking.js';
import { runPostEditChecks, validatePath } from './shared/index.js';

export class AstGrep extends Gadget({
	name: 'AstGrep',
	description: `AST-aware code search and rewriting using ast-grep.
Unlike regex, this understands code structure for precise refactoring.

**Pattern syntax:**
- \`$VAR\` - captures single AST node (identifier, expression, etc.)
- \`$$$ARGS\` - captures multiple nodes (variadic)

**Search examples:**
- \`console.log($MSG)\` - find all console.log calls
- \`function $NAME($$$PARAMS) { $$$BODY }\` - find function declarations
- \`import { $$$IMPORTS } from '$SOURCE'\` - find named imports

**Rewrite examples:**
- pattern: \`console.log($MSG)\` + rewrite: \`logger.info($MSG)\`
- pattern: \`$OBJ.map($FN)\` + rewrite: \`$OBJ.flatMap($FN)\`

Use for:
- Refactoring function calls, imports, patterns
- Finding specific code structures
- Safe, syntax-aware replacements`,
	timeoutMs: 30000,
	maxConcurrent: 1,
	schema: z.object({
		pattern: z.string().describe('AST pattern to match (use $VAR for captures)'),
		language: z
			.string()
			.describe('Language: typescript, javascript, python, rust, go, java, c, cpp'),
		path: z.string().default('.').describe('File or directory to search'),
		rewrite: z
			.string()
			.optional()
			.describe('Replacement pattern (uses captured $VAR). Omit for search-only.'),
	}),
	examples: [
		{
			params: { pattern: 'console.log($MSG)', language: 'typescript', path: 'src/' },
			output: 'src/utils.ts:15:  console.log(error)\nsrc/index.ts:8:  console.log("starting")',
			comment: 'Find all console.log calls',
		},
		{
			params: {
				pattern: 'console.log($MSG)',
				language: 'typescript',
				path: 'src/utils.ts',
				rewrite: 'logger.debug($MSG)',
			},
			output:
				'path=src/utils.ts status=success\n\n- 15 |   console.log(error)\n+ 15 |   logger.debug(error)',
			comment: 'Replace console.log with logger.debug',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		const { pattern, language, path, rewrite } = params;

		if (rewrite) {
			return this.executeRewrite(pattern, language, path, rewrite);
		}
		return this.executeSearch(pattern, language, path);
	}

	private async executeSearch(pattern: string, language: string, path: string): Promise<string> {
		return new Promise((resolve) => {
			const args = ['run', '--pattern', pattern, '--lang', language, '--color=never', path];

			const sg = spawn('sg', args);
			let output = '';
			let errorOutput = '';

			sg.stdout.on('data', (data: Buffer) => {
				output += data.toString();
			});
			sg.stderr.on('data', (data: Buffer) => {
				errorOutput += data.toString();
			});

			sg.on('close', (code) => {
				if (code === 0) {
					resolve(output || 'No matches found.');
				} else if (code === 1) {
					resolve('No matches found.');
				} else {
					resolve(`ast-grep error (code ${code}): ${errorOutput || 'Unknown error'}`);
				}
			});

			sg.on('error', (error) => {
				resolve(
					`Failed to run ast-grep: ${error.message}. Is ast-grep installed? (brew install ast-grep)`,
				);
			});
		});
	}

	private async executeRewrite(
		pattern: string,
		language: string,
		path: string,
		rewrite: string,
	): Promise<string> {
		let validatedPath: string;
		try {
			validatedPath = validatePath(path);
		} catch {
			// For directory paths that don't resolve to a file, run directory rewrite
			return this.executeDirectoryRewrite(pattern, language, path, rewrite);
		}

		assertFileRead(validatedPath, 'AstGrep');

		// Read before content
		let beforeContent: string;
		try {
			beforeContent = readFileSync(validatedPath, 'utf-8');
		} catch {
			// For directory paths, just run ast-grep directly
			return this.executeDirectoryRewrite(pattern, language, path, rewrite);
		}

		return new Promise((resolve) => {
			const args = [
				'run',
				'--pattern',
				pattern,
				'--rewrite',
				rewrite,
				'--lang',
				language,
				'--update-all',
				validatedPath,
			];

			const sg = spawn('sg', args);
			let output = '';
			let errorOutput = '';

			sg.stdout.on('data', (data: Buffer) => {
				output += data.toString();
			});
			sg.stderr.on('data', (data: Buffer) => {
				errorOutput += data.toString();
			});

			sg.on('close', (code) => {
				resolve(this.handleRewriteClose(code, errorOutput, beforeContent, path, validatedPath));
			});

			sg.on('error', (error) => {
				resolve(
					`Failed to run ast-grep: ${error.message}. Is ast-grep installed? (brew install ast-grep)`,
				);
			});
		});
	}

	private handleRewriteClose(
		code: number | null,
		errorOutput: string,
		beforeContent: string,
		path: string,
		validatedPath: string,
	): string {
		if (code !== 0 && code !== 1) {
			return `ast-grep error (code ${code}): ${errorOutput || 'Unknown error'}`;
		}

		let afterContent: string;
		try {
			afterContent = readFileSync(validatedPath, 'utf-8');
		} catch (err) {
			return `Failed to read file after rewrite: ${err}`;
		}

		if (beforeContent === afterContent) {
			return `path=${path} status=no_change\n\nPattern matched nothing or no changes needed.`;
		}

		markFileRead(validatedPath);
		const diff = this.buildDiff(beforeContent, afterContent);
		const diagnosticResult = runPostEditChecks(path, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';
		const diagnosticsOutput = diagnosticResult ? diagnosticResult.statusMessage : '';

		return `path=${path} status=${status}\n\n${diff}${diagnosticsOutput ? `\n\n${diagnosticsOutput}` : ''}`;
	}

	private async executeDirectoryRewrite(
		pattern: string,
		language: string,
		path: string,
		rewrite: string,
	): Promise<string> {
		return new Promise((resolve) => {
			// First, get list of files that will be changed using --json
			const previewArgs = ['run', '--pattern', pattern, '--lang', language, '--json', path];

			const preview = spawn('sg', previewArgs);
			let previewOutput = '';

			preview.stdout.on('data', (data: Buffer) => {
				previewOutput += data.toString();
			});

			preview.on('close', (previewCode) => {
				if (previewCode !== 0 || !previewOutput.trim()) {
					resolve('No matches found.');
					return;
				}

				// Now apply the rewrite
				const rewriteArgs = [
					'run',
					'--pattern',
					pattern,
					'--rewrite',
					rewrite,
					'--lang',
					language,
					'--update-all',
					path,
				];

				const sg = spawn('sg', rewriteArgs);
				let output = '';
				let errorOutput = '';

				sg.stdout.on('data', (data: Buffer) => {
					output += data.toString();
				});
				sg.stderr.on('data', (data: Buffer) => {
					errorOutput += data.toString();
				});

				sg.on('close', (code) => {
					if (code !== 0 && code !== 1) {
						resolve(`ast-grep error (code ${code}): ${errorOutput || 'Unknown error'}`);
						return;
					}

					// Parse preview to show what was changed
					try {
						const matches = JSON.parse(previewOutput) as { file: string }[];
						const fileCount = new Set(matches.map((m) => m.file)).size;
						const matchCount = matches.length;
						resolve(
							`status=success\n\nRewrote ${matchCount} match(es) in ${fileCount} file(s).\n\n${output}`,
						);
					} catch {
						resolve(`status=success\n\nRewrite applied.\n\n${output}`);
					}
				});

				sg.on('error', (error) => {
					resolve(`Failed to run ast-grep: ${error.message}`);
				});
			});
		});
	}

	private buildDiff(before: string, after: string): string {
		const beforeLines = before.split('\n');
		const afterLines = after.split('\n');
		const changes: string[] = [];
		const maxLines = Math.max(beforeLines.length, afterLines.length);

		for (let i = 0; i < maxLines; i++) {
			const bLine = beforeLines[i];
			const aLine = afterLines[i];
			if (bLine !== aLine) {
				if (bLine !== undefined) changes.push(`- ${i + 1} | ${bLine}`);
				if (aLine !== undefined) changes.push(`+ ${i + 1} | ${aLine}`);
			}
		}

		return changes.length > 0 ? changes.join('\n') : '(no visible changes)';
	}
}
