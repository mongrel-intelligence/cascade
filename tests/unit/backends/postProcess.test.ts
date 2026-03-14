import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { postProcessResult } from '../../../src/backends/postProcess.js';
import type { AgentEngine, AgentEngineResult } from '../../../src/backends/types.js';
import type { AgentInput, ProjectConfig } from '../../../src/types/index.js';
import { logger } from '../../../src/utils/logging.js';

function makeEngine(id = 'test-engine'): AgentEngine {
	return {
		definition: {
			id,
			label: id,
			description: `${id} description`,
			capabilities: [],
			modelSelection: { type: 'free-text' },
			logLabel: 'Engine Log',
		},
		execute: vi.fn(),
		supportsAgentType: () => true,
	};
}

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test-project',
		orgId: 'org-1',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		pm: { type: 'trello' },
		...overrides,
	};
}

function makeResult(overrides?: Partial<AgentEngineResult>): AgentEngineResult {
	return {
		success: true,
		output: 'Done',
		...overrides,
	};
}

function makeInput(overrides?: Partial<ProjectConfig>): AgentInput & { project: ProjectConfig } {
	return {
		workItemId: 'card-123',
		project: makeProject(overrides),
	} as AgentInput & { project: ProjectConfig };
}

describe('postProcessResult', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('PR validation for agents with requiresPR', () => {
		it('marks as failed when requiresPR agent succeeds without authoritative PR evidence', () => {
			const result = makeResult({ success: true, prUrl: undefined, prEvidence: undefined });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'implementation-card-123', {
				requiresPR: true,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('Agent completed but no authoritative PR creation was recorded');
		});

		it('logs warning when requiresPR agent succeeds without authoritative PR evidence', () => {
			const result = makeResult({ success: true, prUrl: undefined, prEvidence: undefined });
			const engine = makeEngine('my-engine');
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-id', {
				requiresPR: true,
			});

			expect(logger.warn).toHaveBeenCalledWith(
				'implementation agent completed without authoritative PR evidence',
				{ identifier: 'impl-id', engine: 'my-engine', prUrl: undefined, prEvidenceSource: null },
			);
		});

		it('passes through when requiresPR agent has authoritative PR evidence', () => {
			const result = makeResult({
				success: true,
				prUrl: 'https://github.com/o/r/pull/1',
				prEvidence: { source: 'native-tool-sidecar', authoritative: true },
			});
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-id', {
				requiresPR: true,
			});

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('fails when only text-derived PR evidence exists', () => {
			const result = makeResult({
				success: true,
				prUrl: 'https://github.com/o/r/pull/1',
				prEvidence: { source: 'text', authoritative: false },
			});
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-id', {
				requiresPR: true,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('Agent completed but no authoritative PR creation was recorded');
		});

		it('passes through when requiresPR agent already failed', () => {
			const result = makeResult({ success: false, error: 'Budget exceeded' });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-id', {
				requiresPR: true,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('Budget exceeded');
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('does not validate PR creation when requiresPR is not set', () => {
			const result = makeResult({ success: true, prUrl: undefined, prEvidence: undefined });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'splitting', engine, input, 'splitting-id');

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
		});
	});

	describe('review validation for agents with requiresReview', () => {
		it('marks as failed when requiresReview agent succeeds without authoritative review evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'review', engine, input, 'review-pr-123', {
				requiresReview: true,
				hasAuthoritativeReview: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe(
				'Agent completed but no authoritative PR review submission was recorded',
			);
		});

		it('passes through when requiresReview agent has authoritative review evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'review', engine, input, 'review-pr-123', {
				requiresReview: true,
				hasAuthoritativeReview: true,
			});

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});
	});

	describe('pushed-changes validation for agents with requiresPushedChanges', () => {
		it('marks as failed when requiresPushedChanges agent succeeds without authoritative push evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'respond-to-review', engine, input, 'review-pr-123', {
				requiresPushedChanges: true,
				hasAuthoritativePushedChanges: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe(
				'Agent completed but no authoritative pushed changes were recorded',
			);
		});

		it('passes through when requiresPushedChanges agent has authoritative push evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'respond-to-ci', engine, input, 'ci-pr-123', {
				requiresPushedChanges: true,
				hasAuthoritativePushedChanges: true,
			});

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});
	});
});
