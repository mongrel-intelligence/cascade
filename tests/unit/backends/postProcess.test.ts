import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { postProcessResult } from '../../../src/backends/postProcess.js';
import type { AgentEngine, AgentEngineResult } from '../../../src/backends/types.js';
import { captureException } from '../../../src/sentry.js';
import type { AgentInput, ProjectConfig } from '../../../src/types/index.js';
import { logger } from '../../../src/utils/logging.js';

function makeEngine(id = 'test-engine'): AgentEngine {
	return {
		definition: {
			id,
			label: id,
			description: `${id} description`,
			archetype: 'sdk',
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

		// Prod regression 2026-05-09 (run d8e31665): the no-authoritative-PR
		// failure surfaced only as a per-run record + a one-line WARN. Operators
		// reading `cascade runs list` saw "failed" with no idea whether this is
		// a recurring regression. Sentry capture under a stable tag makes prod
		// frequency loud and gives ops a single dashboard to monitor.
		it('emits a Sentry capture under tag pr_sidecar_invalid when authoritative PR evidence is missing', () => {
			const captureSpy = vi.mocked(captureException);
			captureSpy.mockClear();
			const result = makeResult({
				success: true,
				prUrl: 'https://github.com/o/r/pull/1290',
				prEvidence: { source: 'text', authoritative: false },
			});
			const engine = makeEngine('codex');
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-card-fe82YUKV', {
				requiresPR: true,
			});

			expect(captureSpy).toHaveBeenCalledTimes(1);
			expect(captureSpy).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					tags: expect.objectContaining({
						source: 'pr_sidecar_invalid',
						engine: 'codex',
						agentType: 'implementation',
					}),
					extra: expect.objectContaining({
						identifier: 'impl-card-fe82YUKV',
						prUrl: 'https://github.com/o/r/pull/1290',
						prEvidenceSource: 'text',
					}),
				}),
			);
			// Error message matches the user-visible failure string for grep parity.
			const arg = captureSpy.mock.calls[0]![0] as Error;
			expect(arg.message).toBe('Agent completed but no authoritative PR creation was recorded');
		});

		it('does NOT Sentry-capture when authoritative PR evidence IS present', () => {
			const captureSpy = vi.mocked(captureException);
			captureSpy.mockClear();
			const result = makeResult({
				success: true,
				prUrl: 'https://github.com/o/r/pull/1',
				prEvidence: {
					source: 'native-tool-sidecar',
					authoritative: true,
					command: 'cascade-tools scm create-pr',
				},
			});
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'implementation', engine, input, 'impl-id', {
				requiresPR: true,
			});

			expect(captureSpy).not.toHaveBeenCalled();
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

	describe('PM write validation for agents with requiresPMWrite', () => {
		it('marks as failed when requiresPMWrite agent succeeds without PM write evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'planning', engine, input, 'planning-card-123', {
				requiresPMWrite: true,
				hasPMWrite: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe(
				'Agent completed but no PM write (checklist creation) was recorded',
			);
		});

		it('passes through when requiresPMWrite agent has PM write evidence', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'planning', engine, input, 'planning-card-123', {
				requiresPMWrite: true,
				hasPMWrite: true,
			});

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('passes through when requiresPMWrite agent already failed (no double-failure)', () => {
			const result = makeResult({ success: false, error: 'Budget exceeded' });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'planning', engine, input, 'planning-card-123', {
				requiresPMWrite: true,
				hasPMWrite: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('Budget exceeded');
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('does not validate PM write when requiresPMWrite is not set', () => {
			const result = makeResult({ success: true });
			const engine = makeEngine();
			const input = makeInput();

			postProcessResult(result, 'planning', engine, input, 'planning-card-123');

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
		});
	});
});
