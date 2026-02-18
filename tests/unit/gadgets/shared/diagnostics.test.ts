import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockExecSync, mockExistsSync } = vi.hoisted(() => ({
	mockExecSync: vi.fn(),
	mockExistsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
}));

import {
	runDiagnostics,
	shouldRunDiagnostics,
} from '../../../../src/gadgets/shared/diagnostics.js';

describe('shouldRunDiagnostics', () => {
	it('returns true for .ts files', () => {
		expect(shouldRunDiagnostics('src/file.ts')).toBe(true);
	});

	it('returns true for .tsx files', () => {
		expect(shouldRunDiagnostics('src/component.tsx')).toBe(true);
	});

	it('returns false for .js files', () => {
		expect(shouldRunDiagnostics('src/file.js')).toBe(false);
	});

	it('returns false for .json files', () => {
		expect(shouldRunDiagnostics('config.json')).toBe(false);
	});

	it('returns false for .md files', () => {
		expect(shouldRunDiagnostics('README.md')).toBe(false);
	});

	it('returns false for files with no extension', () => {
		expect(shouldRunDiagnostics('Makefile')).toBe(false);
	});

	it('returns false for .css files', () => {
		expect(shouldRunDiagnostics('styles.css')).toBe(false);
	});
});

describe('runDiagnostics', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Default: tsconfig.json not found, falls back to cwd
		mockExistsSync.mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('when both TypeScript and Biome pass', () => {
		it('returns hasParseErrors=false, hasTypeErrors=false, hasLintErrors=false', () => {
			// TypeScript passes (no throw)
			mockExecSync.mockReturnValueOnce('');
			// Biome passes (no throw)
			mockExecSync.mockReturnValueOnce('Checked 1 file(s)');

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasParseErrors).toBe(false);
			expect(result.hasTypeErrors).toBe(false);
			expect(result.hasLintErrors).toBe(false);
		});

		it('output includes TypeScript and Biome sections', () => {
			mockExecSync.mockReturnValueOnce('');
			mockExecSync.mockReturnValueOnce('Checked 1 file(s)');

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.output).toContain('=== TypeScript Check ===');
			expect(result.output).toContain('=== Biome Lint ===');
			expect(result.output).toContain('No type errors found.');
		});
	});

	describe('when TypeScript has errors', () => {
		it('sets hasTypeErrors=true when output contains the file path', () => {
			const tscError = Object.assign(new Error('tsc failed'), {
				stdout: '/workspace/project/src/file.ts(5,3): error TS2345: Argument of type ...',
				stderr: '',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw tscError;
			});
			// Biome passes
			mockExecSync.mockReturnValueOnce('Checked 1 file(s)');

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasTypeErrors).toBe(true);
			expect(result.hasParseErrors).toBe(false);
		});

		it('sets hasTypeErrors=false when error output does not contain the file path', () => {
			// Type errors in other files, not the one we edited
			const tscError = Object.assign(new Error('tsc failed'), {
				stdout: '/workspace/project/src/other-file.ts(10,1): error TS1234: ...',
				stderr: '',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw tscError;
			});
			mockExecSync.mockReturnValueOnce('');

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasTypeErrors).toBe(false);
		});

		it('preserves raw TypeScript output for error parsing', () => {
			const tscOutput = '/workspace/project/src/file.ts(1,1): error TS2304: Cannot find name';
			const tscError = Object.assign(new Error('tsc failed'), {
				stdout: tscOutput,
				stderr: '',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw tscError;
			});
			mockExecSync.mockReturnValueOnce('');

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.rawTypescript).toContain('TS2304');
		});
	});

	describe('when Biome has parse errors', () => {
		it('sets hasParseErrors=true when Biome output contains "parse"', () => {
			// TypeScript passes
			mockExecSync.mockReturnValueOnce('');
			const biomeError = Object.assign(new Error('biome failed'), {
				stdout: '',
				stderr: '/workspace/project/src/file.ts:5:1 parse error: Unexpected token',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw biomeError;
			});

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasParseErrors).toBe(true);
			expect(result.hasLintErrors).toBe(false);
		});
	});

	describe('when Biome has lint errors', () => {
		it('sets hasLintErrors=true when Biome output mentions the file path', () => {
			mockExecSync.mockReturnValueOnce('');
			const biomeError = Object.assign(new Error('biome failed'), {
				stdout: '',
				stderr: '/workspace/project/src/file.ts:10:5 lint/suspicious/noDebugger\nFound 1 error',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw biomeError;
			});

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasLintErrors).toBe(true);
			expect(result.hasParseErrors).toBe(false);
		});

		it('sets hasLintErrors=false when error output does not mention the file path', () => {
			mockExecSync.mockReturnValueOnce('');
			const biomeError = Object.assign(new Error('biome failed'), {
				stdout: '',
				stderr: 'Some generic biome error with no file reference',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw biomeError;
			});

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.hasLintErrors).toBe(false);
		});

		it('preserves raw Biome output for error parsing', () => {
			mockExecSync.mockReturnValueOnce('');
			const biomeError = Object.assign(new Error('biome failed'), {
				stdout: 'Found 2 errors',
				stderr: '/workspace/project/src/file.ts:1:1 lint error',
			});
			mockExecSync.mockImplementationOnce(() => {
				throw biomeError;
			});

			const result = runDiagnostics('/workspace/project/src/file.ts');

			expect(result.rawBiome).toBeDefined();
		});
	});

	describe('project root detection', () => {
		it('uses directory containing tsconfig.json as project root', () => {
			// Simulate finding tsconfig.json in parent directory
			mockExistsSync.mockImplementation((p: string) => {
				return p === '/workspace/project/tsconfig.json';
			});
			mockExecSync.mockReturnValue('');

			runDiagnostics('/workspace/project/src/file.ts');

			// tsc should be run in /workspace/project (where tsconfig is)
			expect(mockExecSync).toHaveBeenCalledWith(
				'npx tsc --noEmit --pretty false',
				expect.objectContaining({ cwd: '/workspace/project' }),
			);
		});

		it('falls back to process.cwd() when no tsconfig.json found', () => {
			mockExistsSync.mockReturnValue(false);
			mockExecSync.mockReturnValue('');

			const cwd = process.cwd();
			runDiagnostics('/some/deep/path/file.ts');

			expect(mockExecSync).toHaveBeenCalledWith(
				'npx tsc --noEmit --pretty false',
				expect.objectContaining({ cwd }),
			);
		});
	});
});
