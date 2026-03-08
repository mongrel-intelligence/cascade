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

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(() => ({ prUrl: null })),
}));

// Mock resolveAgentDefinition — hintConfig now uses async resolver
vi.mock('../../../src/agents/definitions/index.js', () => ({
	resolveAgentDefinition: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { resolveAgentDefinition } from '../../../src/agents/definitions/index.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { formatTodoList, loadTodos } from '../../../src/gadgets/todo/storage.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadTodos = vi.mocked(loadTodos);
const mockFormatTodoList = vi.mocked(formatTodoList);
const mockResolveAgentDefinition = vi.mocked(resolveAgentDefinition);
const mockGetSessionState = vi.mocked(getSessionState);

const ctx = { iteration: 3, maxIterations: 20 };

/** Minimal agent definition shape for testing */
function makeDefinition(overrides?: {
	hint?: string;
	hooks?: {
		trailing?: {
			scm?: { gitStatus?: boolean; prStatus?: boolean };
			builtin?: { diagnostics?: boolean; todoProgress?: boolean; reminder?: boolean };
		};
	};
}) {
	return {
		hint: overrides?.hint ?? 'Complete the current task efficiently.',
		hooks: overrides?.hooks,
	};
}

/** Helper to invoke the trailing message function */
async function getMessage(
	agentType: string | undefined,
	iteration = 3,
	maxIterations = 20,
): Promise<string> {
	const trailingFn = await getIterationTrailingMessage(agentType);
	return typeof trailingFn === 'function'
		? (trailingFn({ iteration, maxIterations }) as string)
		: (trailingFn as string);
}

describe('getIterationTrailingMessage', () => {
	beforeEach(() => {
		// Default: unknown agent type returns null (no definition)
		mockResolveAgentDefinition.mockResolvedValue(null as never);
	});

	afterEach(() => {
		clearDiagnosticState();
		mockLoadTodos.mockReturnValue([]);
		mockFormatTodoList.mockReturnValue('');
		mockExecSync.mockReturnValue('');
	});

	describe('respond-to-ci agent', () => {
		beforeEach(() => {
			mockResolveAgentDefinition.mockImplementation(async (agentType: string) => {
				if (agentType === 'respond-to-ci') {
					return makeDefinition({
						hint: 'Fix CI failures with minimal, focused changes.',
						hooks: { trailing: { builtin: { diagnostics: true } } },
					}) as never;
				}
				return null as never;
			});
		});

		it('includes diagnostic status when there are errors', async () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const trailingFn = await getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
			expect(message).toContain('BaseApiService.ts');
		});

		it('does not include diagnostic status when no errors', async () => {
			const trailingFn = await getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).not.toContain('Diagnostic Status');
			expect(message).toContain('Iteration');
		});

		it('includes diagnostic loop warning when file edited >= 2 times with errors', async () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/BaseApiService.ts');
			recordDiagnosticLoop('src/BaseApiService.ts');

			const trailingFn = await getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('BaseApiService.ts');
			expect(message).toContain('edited 2 times');
		});

		it('does not include loop warning below threshold', async () => {
			updateDiagnosticState('src/BaseApiService.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/BaseApiService.ts');

			const trailingFn = await getIterationTrailingMessage('respond-to-ci');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
			expect(message).not.toContain('Diagnostic Loop Detected');
		});
	});

	describe('respond-to-review agent', () => {
		beforeEach(() => {
			mockResolveAgentDefinition.mockImplementation(async (agentType: string) => {
				if (agentType === 'respond-to-review') {
					return makeDefinition({
						hooks: { trailing: { builtin: { diagnostics: true } } },
					}) as never;
				}
				return null as never;
			});
		});

		it('still includes diagnostic status when there are errors', async () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const trailingFn = await getIterationTrailingMessage('respond-to-review');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).toContain('Diagnostic Status');
		});
	});

	describe('other agents', () => {
		it('does not include diagnostics for review agent', async () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			// review agent has no trailingMessage.includeDiagnostics
			mockResolveAgentDefinition.mockResolvedValue(makeDefinition({}) as never);

			const trailingFn = await getIterationTrailingMessage('review');
			const message = typeof trailingFn === 'function' ? trailingFn(ctx) : trailingFn;

			expect(message).not.toContain('Diagnostic Status');
		});
	});

	// ============================================================================
	// Implementation trailing message (Steps 8-10)
	// ============================================================================

	describe('implementation agent trailing message', () => {
		beforeEach(() => {
			mockResolveAgentDefinition.mockImplementation(async (agentType: string) => {
				if (agentType === 'implementation') {
					return makeDefinition({
						hint: 'Batch related edits together.',
						hooks: {
							trailing: {
								scm: { gitStatus: true, prStatus: true },
								builtin: { diagnostics: true, todoProgress: true, reminder: true },
							},
						},
					}) as never;
				}
				return null as never;
			});
		});

		it('includes todos section when todos are present', async () => {
			mockLoadTodos.mockReturnValue([
				{ id: '1', content: 'Write tests', status: 'in_progress', createdAt: '', updatedAt: '' },
			]);
			mockFormatTodoList.mockReturnValue('🔄 #1 [in_progress]: Write tests');

			const message = await getMessage('implementation');

			expect(message).toContain('Current Progress');
			expect(message).toContain('Write tests');
		});

		it('omits todos section when todos list is empty', async () => {
			mockLoadTodos.mockReturnValue([]);

			const message = await getMessage('implementation');

			expect(message).not.toContain('Current Progress');
		});

		it('shows git status section with content when git status returns output', async () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if ((cmd as string).includes('git status')) return 'M src/index.ts';
				return '';
			});

			const message = await getMessage('implementation');

			expect(message).toContain('## Git Status');
			expect(message).toContain('M src/index.ts');
		});

		it('shows "No uncommitted changes" when git status is empty', async () => {
			mockExecSync.mockReturnValue('');

			const message = await getMessage('implementation');

			expect(message).toContain('## Git Status');
			expect(message).toContain('No uncommitted changes');
		});

		it('shows PR status with URL when PR has been created', async () => {
			mockGetSessionState.mockReturnValue({
				prUrl: 'https://github.com/acme/myapp/pull/42',
			} as never);

			const message = await getMessage('implementation');

			expect(message).toContain('## PR Status');
			expect(message).toContain('PR created: https://github.com/acme/myapp/pull/42');
		});

		it('shows "No PR exists" when no PR in session state', async () => {
			mockGetSessionState.mockReturnValue({ prUrl: null } as never);

			const message = await getMessage('implementation');

			expect(message).toContain('## PR Status');
			expect(message).toContain('No PR exists for current branch');
		});

		it('always includes reminder section', async () => {
			const message = await getMessage('implementation');

			expect(message).toContain('## Reminder');
		});

		it('includes diagnostic status when implementation has errors', async () => {
			updateDiagnosticState('src/broken.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});

			const message = await getMessage('implementation');

			expect(message).toContain('Diagnostic Status');
			expect(message).toContain('broken.ts');
		});

		it('does not include diagnostic status when implementation has no errors', async () => {
			const message = await getMessage('implementation');

			expect(message).not.toContain('Diagnostic Status');
		});
	});

	// ============================================================================
	// formatIterationStatus urgency levels (Step 9)
	// ============================================================================

	describe('formatIterationStatus urgency levels', () => {
		beforeEach(() => {
			mockResolveAgentDefinition.mockImplementation(async (agentType: string) => {
				if (agentType === 'implementation') {
					return makeDefinition({ hint: 'Batch related edits together.' }) as never;
				}
				if (agentType === 'review') {
					return makeDefinition({ hint: 'Focus on the current aspect.' }) as never;
				}
				return null as never;
			});
		});

		it('uses no emoji at < 50% usage', async () => {
			// iteration=3, maxIterations=20 → 15% — no emoji
			const message = await getMessage('review', 3, 20);
			expect(message).not.toContain('🚨');
			expect(message).not.toContain('⚠️');
			expect(message).toContain('Iteration 3/20');
		});

		it('uses ⚠️ at 50-79% usage', async () => {
			// iteration=12, maxIterations=20 → 60%
			const message = await getMessage('review', 12, 20);
			expect(message).toContain('⚠️');
			expect(message).not.toContain('🚨');
		});

		it('uses 🚨 at >= 80% usage', async () => {
			// iteration=16, maxIterations=20 → 80%
			const message = await getMessage('review', 16, 20);
			expect(message).toContain('🚨');
		});

		it('uses 🚨 above 80% usage', async () => {
			// iteration=19, maxIterations=20 → 95%
			const message = await getMessage('review', 19, 20);
			expect(message).toContain('🚨');
		});

		it('includes correct remaining count in message', async () => {
			const message = await getMessage('review', 12, 20);
			expect(message).toContain('8 remaining');
		});

		it('includes correct percentage in message', async () => {
			const message = await getMessage('review', 10, 20);
			expect(message).toContain('50% used');
		});

		it('uses agent-specific hint for implementation', async () => {
			const message = await getMessage('implementation');
			expect(message).toContain('Batch related edits');
		});

		it('uses agent-specific hint for review', async () => {
			const message = await getMessage('review');
			expect(message).toContain('Focus on the current aspect');
		});

		it('uses default hint for unknown agent type', async () => {
			// mockResolveAgentDefinition returns null for unknown types (set in beforeEach)
			const message = await getMessage('some-unknown-agent');
			expect(message).toContain('Complete the current task efficiently');
		});

		it('uses default hint when agentType is undefined', async () => {
			const message = await getMessage(undefined);
			expect(message).toContain('Complete the current task efficiently');
		});
	});

	// ============================================================================
	// formatDiagnosticLoopWarning (Step 10)
	// ============================================================================

	describe('formatDiagnosticLoopWarning via implementation', () => {
		beforeEach(() => {
			mockResolveAgentDefinition.mockImplementation(async (agentType: string) => {
				if (agentType === 'implementation') {
					return makeDefinition({
						hooks: { trailing: { builtin: { diagnostics: true } } },
					}) as never;
				}
				return null as never;
			});
		});

		it('no warning when no loops', async () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			// No recordDiagnosticLoop calls

			const message = await getMessage('implementation');

			expect(message).not.toContain('Diagnostic Loop Detected');
		});

		it('no warning when loop count is 1 (below threshold of 2)', async () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/file.ts'); // count = 1

			const message = await getMessage('implementation');

			expect(message).not.toContain('Diagnostic Loop Detected');
		});

		it('includes warning with file path and count when loop count is 2', async () => {
			updateDiagnosticState('src/file.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/file.ts'); // count = 1
			recordDiagnosticLoop('src/file.ts'); // count = 2

			const message = await getMessage('implementation');

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('src/file.ts');
			expect(message).toContain('edited 2 times');
		});

		it('includes warning with correct count when loop count is 3', async () => {
			updateDiagnosticState('src/utils.ts', {
				output: '',
				hasTypeErrors: true,
				hasParseErrors: false,
				hasLintErrors: false,
			});
			recordDiagnosticLoop('src/utils.ts');
			recordDiagnosticLoop('src/utils.ts');
			recordDiagnosticLoop('src/utils.ts');

			const message = await getMessage('implementation');

			expect(message).toContain('Diagnostic Loop Detected');
			expect(message).toContain('src/utils.ts');
			expect(message).toContain('edited 3 times');
		});
	});
});
