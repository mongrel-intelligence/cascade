import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the core diagnostics module to avoid running actual tsc/biome
vi.mock('../../../../src/gadgets/shared/diagnostics.js', () => ({
	runDiagnostics: vi.fn(),
	shouldRunDiagnostics: vi.fn(),
}));

import {
	clearDiagnosticState,
	formatDiagnosticStatus,
	runDiagnosticsWithTracking,
	updateDiagnosticState,
} from '../../../../src/gadgets/shared/diagnosticState.js';
import {
	runDiagnostics,
	shouldRunDiagnostics,
} from '../../../../src/gadgets/shared/diagnostics.js';

const mockRunDiagnostics = vi.mocked(runDiagnostics);
const mockShouldRunDiagnostics = vi.mocked(shouldRunDiagnostics);

afterEach(() => {
	clearDiagnosticState();
	vi.clearAllMocks();
});

describe('updateDiagnosticState', () => {
	describe('TypeScript error parsing', () => {
		it('parses TypeScript errors from raw output', () => {
			const tsOutput = '/workspace/src/file.ts(10,5): error TS2345: Argument of type string';
			updateDiagnosticState(
				'/workspace/src/file.ts',
				{ hasTypeErrors: true, hasParseErrors: false, hasLintErrors: false },
				{ typescript: tsOutput },
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('TS2345');
			expect(status).toContain('Argument of type string');
		});

		it('parses line number from TypeScript output', () => {
			const tsOutput = '/workspace/src/file.ts(42,3): error TS1234: Some error';
			updateDiagnosticState(
				'/workspace/src/file.ts',
				{ hasTypeErrors: true, hasParseErrors: false, hasLintErrors: false },
				{ typescript: tsOutput },
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('line 42');
		});

		it('falls back to generic message when no pattern matches', () => {
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: true, hasParseErrors: false, hasLintErrors: false },
				// No raw output — should use generic fallback
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('Type errors detected');
		});

		it('ignores TS error lines not matching the file path', () => {
			const tsOutput = '/workspace/src/other.ts(10,5): error TS2345: Some error';
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: true, hasParseErrors: false, hasLintErrors: false },
				{ typescript: tsOutput },
			);

			const status = formatDiagnosticStatus();
			// Falls back to generic since the error is in other.ts
			expect(status).toContain('Type errors detected');
		});
	});

	describe('Biome parse error parsing', () => {
		it('parses biome parse errors', () => {
			const biomeOutput = 'src/file.ts:5:10 parse error something went wrong';
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: false, hasParseErrors: true, hasLintErrors: false },
				{ biome: biomeOutput },
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('Parse');
			expect(status).toContain('parse error');
		});

		it('falls back to generic parse error message', () => {
			updateDiagnosticState('src/file.ts', {
				hasTypeErrors: false,
				hasParseErrors: true,
				hasLintErrors: false,
			});

			const status = formatDiagnosticStatus();
			expect(status).toContain('Parse error detected');
		});
	});

	describe('Biome lint error parsing', () => {
		it('parses lint rule names from biome output', () => {
			const biomeOutput = `
src/file.ts:3:5 lint/suspicious/noDoubleEquals
      3 │ if (x == y) {}
`;
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: false, hasParseErrors: false, hasLintErrors: true },
				{ biome: biomeOutput },
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('noDoubleEquals');
		});

		it('deduplicates repeated lint rules to single error entry', () => {
			const biomeOutput = `
src/file.ts:3:5 lint/suspicious/noDoubleEquals
src/file.ts:7:5 lint/suspicious/noDoubleEquals
src/file.ts:9:5 lint/suspicious/noBannedTypes
`;
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: false, hasParseErrors: false, hasLintErrors: true },
				{ biome: biomeOutput },
			);

			const status = formatDiagnosticStatus();
			// Both distinct rule names should appear
			expect(status).toContain('noDoubleEquals');
			expect(status).toContain('noBannedTypes');
			// The file should show 2 errors (one per unique rule)
			expect(status).toContain('2 errors');
		});

		it('falls back to generic lint error message when no rules found', () => {
			const biomeOutput = 'src/file.ts:5:10 some non-lint error';
			updateDiagnosticState(
				'src/file.ts',
				{ hasTypeErrors: false, hasParseErrors: false, hasLintErrors: true },
				{ biome: biomeOutput },
			);

			const status = formatDiagnosticStatus();
			expect(status).toContain('lint error');
		});

		it('falls back to generic lint error when no raw output', () => {
			updateDiagnosticState('src/file.ts', {
				hasTypeErrors: false,
				hasParseErrors: false,
				hasLintErrors: true,
			});

			const status = formatDiagnosticStatus();
			expect(status).toContain('Lint error(s) detected');
		});
	});

	describe('state management', () => {
		it('removes file from tracking when all errors are resolved', () => {
			updateDiagnosticState('src/file.ts', {
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			let status = formatDiagnosticStatus();
			expect(status).toContain('⚠️');

			// Fix the errors
			updateDiagnosticState('src/file.ts', {
				hasTypeErrors: false,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			status = formatDiagnosticStatus();
			expect(status).toContain('✅ All edited files pass type checking');
		});

		it('tracks multiple files independently', () => {
			updateDiagnosticState('src/file1.ts', {
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			updateDiagnosticState('src/file2.ts', {
				hasTypeErrors: false,
				hasParseErrors: true,
				hasLintErrors: false,
			});

			const status = formatDiagnosticStatus();
			expect(status).toContain('src/file1.ts');
			expect(status).toContain('src/file2.ts');
			expect(status).toContain('2 file(s)');
		});
	});
});

describe('formatDiagnosticStatus', () => {
	it('returns success message when no errors', () => {
		const status = formatDiagnosticStatus();
		expect(status).toBe('## Diagnostic Status [v2]\n\n✅ All edited files pass type checking');
	});

	it('shows error count per file', () => {
		updateDiagnosticState('src/file.ts', {
			hasTypeErrors: true,
			hasParseErrors: true,
			hasLintErrors: false,
		});

		const status = formatDiagnosticStatus();
		expect(status).toContain('2 errors');
	});

	it('shows singular "error" for exactly 1 error', () => {
		updateDiagnosticState('src/file.ts', {
			hasTypeErrors: true,
			hasParseErrors: false,
			hasLintErrors: false,
		});

		const status = formatDiagnosticStatus();
		expect(status).toMatch(/1 error\b/);
	});

	it('includes file path in output', () => {
		updateDiagnosticState('src/myModule.ts', {
			hasTypeErrors: true,
			hasParseErrors: false,
			hasLintErrors: false,
		});

		const status = formatDiagnosticStatus();
		expect(status).toContain('src/myModule.ts');
	});
});

describe('runDiagnosticsWithTracking', () => {
	it('returns null when diagnostics should not run for file type', () => {
		mockShouldRunDiagnostics.mockReturnValue(false);

		const result = runDiagnosticsWithTracking('config.json', '/abs/config.json');
		expect(result).toBeNull();
		expect(mockRunDiagnostics).not.toHaveBeenCalled();
	});

	it('returns hasErrors=false when no issues found', () => {
		mockShouldRunDiagnostics.mockReturnValue(true);
		mockRunDiagnostics.mockReturnValue({
			hasTypeErrors: false,
			hasParseErrors: false,
			hasLintErrors: false,
		});

		const result = runDiagnosticsWithTracking('src/file.ts', '/abs/src/file.ts');
		expect(result).not.toBeNull();
		expect(result?.hasErrors).toBe(false);
		expect(result?.statusMessage).toBe('✓ No issues');
	});

	it('returns hasErrors=true when TypeScript errors found', () => {
		mockShouldRunDiagnostics.mockReturnValue(true);
		mockRunDiagnostics.mockReturnValue({
			hasTypeErrors: true,
			hasParseErrors: false,
			hasLintErrors: false,
			rawTypescript: '/abs/src/file.ts(5,3): error TS2345: error TS2345: Something is wrong',
		});

		const result = runDiagnosticsWithTracking('src/file.ts', '/abs/src/file.ts');
		expect(result?.hasErrors).toBe(true);
		expect(result?.statusMessage).toContain('diagnostic issue');
	});

	it('returns hasErrors=true when parse errors found', () => {
		mockShouldRunDiagnostics.mockReturnValue(true);
		mockRunDiagnostics.mockReturnValue({
			hasTypeErrors: false,
			hasParseErrors: true,
			hasLintErrors: false,
		});

		const result = runDiagnosticsWithTracking('src/file.ts', '/abs/src/file.ts');
		expect(result?.hasErrors).toBe(true);
	});

	it('updates diagnostic state after running', () => {
		mockShouldRunDiagnostics.mockReturnValue(true);
		mockRunDiagnostics.mockReturnValue({
			hasTypeErrors: true,
			hasParseErrors: false,
			hasLintErrors: false,
		});

		runDiagnosticsWithTracking('src/file.ts', '/abs/src/file.ts');

		const status = formatDiagnosticStatus();
		expect(status).toContain('⚠️');
		expect(status).toContain('src/file.ts');
	});

	it('calls runDiagnostics with the validated path', () => {
		mockShouldRunDiagnostics.mockReturnValue(true);
		mockRunDiagnostics.mockReturnValue({
			hasTypeErrors: false,
			hasParseErrors: false,
			hasLintErrors: false,
		});

		runDiagnosticsWithTracking('src/file.ts', '/abs/workspace/src/file.ts');

		expect(mockRunDiagnostics).toHaveBeenCalledWith('/abs/workspace/src/file.ts');
	});
});
