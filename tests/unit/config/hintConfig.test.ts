import { afterEach, describe, expect, it, vi } from 'vitest';

import { getIterationTrailingMessage } from '../../../src/config/hintConfig.js';
import {
	clearDiagnosticState,
	recordDiagnosticLoop,
	updateDiagnosticState,
} from '../../../src/gadgets/shared/diagnosticState.js';

// Mock external dependencies that hintConfig uses
vi.mock('node:child_process', () => ({
	execSync: vi.fn(() => ''),
}));

vi.mock('../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(() => []),
	formatTodoList: vi.fn(() => ''),
}));

const ctx = { iteration: 3, maxIterations: 20 };

describe('getIterationTrailingMessage', () => {
	afterEach(() => {
		clearDiagnosticState();
	});

	describe('respond-to-ci agent', () => {
		it('includes diagnostic status when there are errors', () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const trailingFn = getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
			expect(message).toContain('BaseApiService.ts');
		});

		it('does not include diagnostic status when no errors', () => {
			const trailingFn = getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).not.toContain('Diagnostic Status');
			expect(message).toContain('Iteration');
		});

		it('includes diagnostic loop warning when file edited >= 2 times with errors', () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/BaseApiService.ts');
			recordDiagnosticLoop('src/BaseApiService.ts');

			const trailingFn = getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('BaseApiService.ts');
			expect(message).toContain('edited 2 times');
		});

		it('does not include loop warning below threshold', () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/BaseApiService.ts');

			const trailingFn = getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
			expect(message).not.toContain('Diagnostic Loop Detected');
		});
	});

	describe('respond-to-review agent', () => {
		it('still includes diagnostic status when there are errors', () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const trailingFn = getIterationTrailingMessage('respond-to-review');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
		});
	});

	describe('other agents', () => {
		it('does not include diagnostics for review agent', () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const trailingFn = getIterationTrailingMessage('review');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).not.toContain('Diagnostic Status');
		});
	});
});
