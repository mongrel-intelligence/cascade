import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { postProcessResult } from '../../../src/backends/postProcess.js';
import type { AgentBackend, AgentBackendResult } from '../../../src/backends/types.js';
import type { AgentInput, ProjectConfig } from '../../../src/types/index.js';
import { logger } from '../../../src/utils/logging.js';

function makeBackend(name = 'test-backend'): AgentBackend {
	return {
		name,
		execute: vi.fn(),
		supportsAgentType: () => true,
	};
}

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test-project',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		...overrides,
	};
}

function makeResult(overrides?: Partial<AgentBackendResult>): AgentBackendResult {
	return {
		success: true,
		output: 'Done',
		...overrides,
	};
}

function makeInput(overrides?: Partial<ProjectConfig>): AgentInput & { project: ProjectConfig } {
	return {
		cardId: 'card-123',
		project: makeProject(overrides),
	} as AgentInput & { project: ProjectConfig };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('postProcessResult', () => {
	describe('PR validation for implementation agents', () => {
		it('marks as failed when implementation agent succeeds without prUrl', () => {
			const result = makeResult({ success: true, prUrl: undefined });
			const backend = makeBackend();
			const input = makeInput();

			postProcessResult(result, 'implementation', backend, input, 'implementation-card-123');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Implementation completed but no PR was created');
		});

		it('logs warning when implementation agent succeeds without prUrl', () => {
			const result = makeResult({ success: true, prUrl: undefined });
			const backend = makeBackend('my-backend');
			const input = makeInput();

			postProcessResult(result, 'implementation', backend, input, 'impl-id');

			expect(logger.warn).toHaveBeenCalledWith(
				'Implementation agent completed without creating a PR',
				{ identifier: 'impl-id', backend: 'my-backend' },
			);
		});

		it('passes through when implementation agent succeeds with prUrl', () => {
			const result = makeResult({ success: true, prUrl: 'https://github.com/o/r/pull/1' });
			const backend = makeBackend();
			const input = makeInput();

			postProcessResult(result, 'implementation', backend, input, 'impl-id');

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('passes through when implementation agent already failed', () => {
			const result = makeResult({ success: false, error: 'Budget exceeded' });
			const backend = makeBackend();
			const input = makeInput();

			postProcessResult(result, 'implementation', backend, input, 'impl-id');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Budget exceeded');
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('does not validate PR creation for non-implementation agents', () => {
			const result = makeResult({ success: true, prUrl: undefined });
			const backend = makeBackend();
			const input = makeInput();

			postProcessResult(result, 'briefing', backend, input, 'briefing-id');

			expect(result.success).toBe(true);
			expect(logger.warn).not.toHaveBeenCalled();
		});
	});

	describe('subscription cost zeroing', () => {
		it('zeroes cost for claude-code backend with subscriptionCostZero=true', () => {
			const result = makeResult({ success: true, cost: 2.5 });
			const backend = makeBackend('claude-code');
			const input = makeInput();
			input.project.agentBackend = {
				default: 'claude-code',
				overrides: {},
				subscriptionCostZero: true,
			};

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBe(0);
			expect(logger.info).toHaveBeenCalledWith(
				'Zeroing Claude Code cost (subscription mode)',
				expect.objectContaining({ originalCost: 2.5 }),
			);
		});

		it('preserves cost when subscriptionCostZero is false', () => {
			const result = makeResult({ success: true, cost: 1.5 });
			const backend = makeBackend('claude-code');
			const input = makeInput();
			input.project.agentBackend = {
				default: 'claude-code',
				overrides: {},
				subscriptionCostZero: false,
			};

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBe(1.5);
		});

		it('preserves cost for non-claude-code backends', () => {
			const result = makeResult({ success: true, cost: 3.0 });
			const backend = makeBackend('llmist');
			const input = makeInput();
			input.project.agentBackend = {
				default: 'llmist',
				overrides: {},
				subscriptionCostZero: true,
			};

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBe(3.0);
		});

		it('preserves cost when agentBackend config is undefined', () => {
			const result = makeResult({ success: true, cost: 1.0 });
			const backend = makeBackend('claude-code');
			const input = makeInput();
			// no agentBackend set

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBe(1.0);
		});

		it('preserves zero cost without logging', () => {
			const result = makeResult({ success: true, cost: 0 });
			const backend = makeBackend('claude-code');
			const input = makeInput();
			input.project.agentBackend = {
				default: 'claude-code',
				overrides: {},
				subscriptionCostZero: true,
			};

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBe(0);
			expect(logger.info).not.toHaveBeenCalled();
		});

		it('passes through when cost is undefined', () => {
			const result = makeResult({ success: true, cost: undefined });
			const backend = makeBackend('claude-code');
			const input = makeInput();
			input.project.agentBackend = {
				default: 'claude-code',
				overrides: {},
				subscriptionCostZero: true,
			};

			postProcessResult(result, 'implementation', backend, input, 'id');

			expect(result.cost).toBeUndefined();
		});
	});
});
