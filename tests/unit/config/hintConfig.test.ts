import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { execSync } from 'node:child_process';
import { formatTodoList, loadTodos } from '../../../src/gadgets/todo/storage.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadTodos = vi.mocked(loadTodos);
const mockFormatTodoList = vi.mocked(formatTodoList);

const ctx = { iteration: 3, maxIterations: 20 };

/** Helper to invoke the trailing message function */
function getMessage(agentType: string | undefined, iteration = 3, maxIterations = 20): string {
	const trailingFn = getIterationTrailingMessage(agentType);
	return typeof trailingFn === 'function'
		? (trailingFn({ iteration, maxIterations }) as string)
		: (trailingFn as string);
}

describe('getIterationTrailingMessage', () => {
	afterEach(() => {
		clearDiagnosticState();
		vi.clearAllMocks();
		mockLoadTodos.mockReturnValue([]);
		mockFormatTodoList.mockReturnValue('');
		mockExecSync.mockReturnValue('');
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

	// ============================================================================
	// Implementation trailing message (Steps 8-10)
	// ============================================================================

	describe('implementation agent trailing message', () => {
		it('includes todos section when todos are present', () => {
			mockLoadTodos.mockReturnValue([
				{ id: '1', content: 'Write tests', status: 'in_progress', createdAt: '', updatedAt: '' },
			]);
			mockFormatTodoList.mockReturnValue('🔄 #1 [in_progress]: Write tests');

			const message = getMessage('implementation');

			expect(message).toContain('Current Progress');
			expect(message).toContain('Write tests');
		});

		it('omits todos section when todos list is empty', () => {
			mockLoadTodos.mockReturnValue([]);

			const message = getMessage('implementation');

			expect(message).not.toContain('Current Progress');
		});

		it('shows git status section with content when git status returns output', () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if ((cmd as string).includes('git status')) return 'M src/index.ts';
				return '';
			});

			const message = getMessage('implementation');

			expect(message).toContain('## Git Status');
			expect(message).toContain('M src/index.ts');
		});

		it('shows "No uncommitted changes" when git status is empty', () => {
			mockExecSync.mockReturnValue('');

			const message = getMessage('implementation');

			expect(message).toContain('## Git Status');
			expect(message).toContain('No uncommitted changes');
		});

		it('shows PR status with content when gh pr view returns output', () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if ((cmd as string).includes('gh pr view')) return 'title: My PR\nurl: http://...';
				return '';
			});

			const message = getMessage('implementation');

			expect(message).toContain('## PR Status');
			expect(message).toContain('My PR');
		});

		it('shows "No PR exists" when gh pr view returns empty', () => {
			mockExecSync.mockReturnValue('');

			const message = getMessage('implementation');

			expect(message).toContain('## PR Status');
			expect(message).toContain('No PR exists for current branch');
		});

		it('always includes reminder section', () => {
			const message = getMessage('implementation');

			expect(message).toContain('## Reminder');
		});

		it('includes diagnostic status when implementation has errors', () => {
			updateDiagnosticState('src/broken.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const message = getMessage('implementation');

			expect(message).toContain('Diagnostic Status');
			expect(message).toContain('broken.ts');
		});

		it('does not include diagnostic status when implementation has no errors', () => {
			const message = getMessage('implementation');

			expect(message).not.toContain('Diagnostic Status');
		});
	});

	// ============================================================================
	// formatIterationStatus urgency levels (Step 9)
	// ============================================================================

	describe('formatIterationStatus urgency levels', () => {
		it('uses no emoji at < 50% usage', () => {
			// iteration=3, maxIterations=20 → 15% — no emoji
			const message = getMessage('review', 3, 20);
			expect(message).not.toContain('🚨');
			expect(message).not.toContain('⚠️');
			expect(message).toContain('Iteration 3/20');
		});

		it('uses ⚠️ at 50-79% usage', () => {
			// iteration=12, maxIterations=20 → 60%
			const message = getMessage('review', 12, 20);
			expect(message).toContain('⚠️');
			expect(message).not.toContain('🚨');
		});

		it('uses 🚨 at >= 80% usage', () => {
			// iteration=16, maxIterations=20 → 80%
			const message = getMessage('review', 16, 20);
			expect(message).toContain('🚨');
		});

		it('uses 🚨 above 80% usage', () => {
			// iteration=19, maxIterations=20 → 95%
			const message = getMessage('review', 19, 20);
			expect(message).toContain('🚨');
		});

		it('includes correct remaining count in message', () => {
			const message = getMessage('review', 12, 20);
			expect(message).toContain('8 remaining');
		});

		it('includes correct percentage in message', () => {
			const message = getMessage('review', 10, 20);
			expect(message).toContain('50% used');
		});

		it('uses agent-specific hint for implementation', () => {
			const message = getMessage('implementation');
			expect(message).toContain('Batch related edits');
		});

		it('uses agent-specific hint for review', () => {
			const message = getMessage('review');
			expect(message).toContain('Focus on the current aspect');
		});

		it('uses default hint for unknown agent type', () => {
			const message = getMessage('some-unknown-agent');
			expect(message).toContain('Complete the current task efficiently');
		});

		it('uses default hint when agentType is undefined', () => {
			const message = getMessage(undefined);
			expect(message).toContain('Complete the current task efficiently');
		});
	});

	// ============================================================================
	// formatDiagnosticLoopWarning (Step 10)
	// ============================================================================

	describe('formatDiagnosticLoopWarning via implementation', () => {
		it('no warning when no loops', () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			// No recordDiagnosticLoop calls

			const message = getMessage('implementation');

			expect(message).not.toContain('Diagnostic Loop Detected');
		});

		it('no warning when loop count is 1 (below threshold of 2)', () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/file.ts'); // count = 1

			const message = getMessage('implementation');

			expect(message).not.toContain('Diagnostic Loop Detected');
		});

		it('includes warning with file path and count when loop count is 2', () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/file.ts'); // count = 1
			recordDiagnosticLoop('src/file.ts'); // count = 2

			const message = getMessage('implementation');

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('src/file.ts');
			expect(message).toContain('edited 2 times');
		});

		it('includes warning with correct count when loop count is 3', () => {
			updateDiagnosticState('src/utils.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/utils.ts');
			recordDiagnosticLoop('src/utils.ts');
			recordDiagnosticLoop('src/utils.ts');

			const message = getMessage('implementation');

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('src/utils.ts');
			expect(message).toContain('edited 3 times');
		});
	});
});
