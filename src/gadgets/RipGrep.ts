import { spawn } from 'node:child_process';
import { Gadget, z } from 'llmist';

export class RipGrep extends Gadget({
	name: 'RipGrep',
	description: `Search for patterns in source files using ripgrep.
Respects gitignore. Returns matching lines with file paths and line numbers.

Use this for:
- Finding function/class definitions
- Searching for imports or usages
- Locating error messages or strings`,
	schema: z.object({
		pattern: z.string().describe('Regex pattern to search for'),
		path: z.string().default('.').describe('Path to search in'),
		glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts")'),
		maxResults: z.number().int().default(100).describe('Maximum results to return'),
	}),
	examples: [
		{
			params: { pattern: 'class.*Repository', path: '.', glob: '*.ts', maxResults: 100 },
			output: 'src/repos/UserRepo.ts:5:export class UserRepository {',
			comment: 'Find repository classes',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		const { pattern, path, glob, maxResults } = params;

		return new Promise((resolve) => {
			const args = ['--color=never', '--line-number', '--no-heading', '-m', String(maxResults)];

			if (glob) {
				args.push('-g', glob);
			}

			args.push(pattern, path);

			const rg = spawn('rg', args);
			let output = '';
			let errorOutput = '';

			rg.stdout.on('data', (data: Buffer) => {
				output += data.toString();
			});
			rg.stderr.on('data', (data: Buffer) => {
				errorOutput += data.toString();
			});

			rg.on('close', (code) => {
				if (code === 0 || code === 1) {
					resolve(output || 'No matches found.');
				} else {
					resolve(`ripgrep error (code ${code}): ${errorOutput || 'Unknown error'}`);
				}
			});

			rg.on('error', (error) => {
				resolve(`Failed to run ripgrep: ${error.message}. Is ripgrep installed?`);
			});
		});
	}
}
