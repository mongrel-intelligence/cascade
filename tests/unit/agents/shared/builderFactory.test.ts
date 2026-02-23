import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/squintDb.js', () => ({
	resolveSquintDbPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/config/compactionConfig.js', () => ({
	getCompactionConfig: vi.fn().mockReturnValue({ maxTokens: 100000, strategy: 'hybrid' }),
}));

vi.mock('../../../../src/config/hintConfig.js', () => ({
	getIterationTrailingMessage: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/config/rateLimits.js', () => ({
	getRateLimitForModel: vi.fn().mockReturnValue({ rpm: 60, tpm: 100000 }),
}));

vi.mock('../../../../src/config/retryConfig.js', () => ({
	getRetryConfig: vi.fn().mockReturnValue({ maxRetries: 3 }),
}));

vi.mock('../../../../src/gadgets/sessionState.js', () => ({
	initSessionState: vi.fn(),
}));

vi.mock('../../../../src/agents/utils/hooks.js', () => ({
	createObserverHooks: vi.fn().mockReturnValue({ onIteration: vi.fn() }),
}));

// Mock llmist
const mockBuilderInstance = {
	withModel: vi.fn(),
	withTemperature: vi.fn(),
	withSystem: vi.fn(),
	withMaxIterations: vi.fn(),
	withLogger: vi.fn(),
	withRateLimits: vi.fn(),
	withRetry: vi.fn(),
	withCompaction: vi.fn(),
	withTrailingMessage: vi.fn(),
	withTextOnlyHandler: vi.fn(),
	withHooks: vi.fn(),
	withGadgets: vi.fn(),
	withMaxGadgetsPerResponse: vi.fn(),
	withBudget: vi.fn(),
};

// Each method returns the builder for chaining
for (const key of Object.keys(mockBuilderInstance)) {
	(mockBuilderInstance as Record<string, unknown>)[key] = vi
		.fn()
		.mockReturnValue(mockBuilderInstance);
}

vi.mock('llmist', () => ({
	AgentBuilder: vi.fn().mockImplementation(() => mockBuilderInstance),
	BudgetPricingUnavailableError: class BudgetPricingUnavailableError extends Error {},
}));

import { AgentBuilder, BudgetPricingUnavailableError } from 'llmist';
import {
	createConfiguredBuilder,
	isSquintEnabled,
} from '../../../../src/agents/shared/builderFactory.js';
import { initSessionState } from '../../../../src/gadgets/sessionState.js';
import { resolveSquintDbPath } from '../../../../src/utils/squintDb.js';

const mockResolveSquintDbPath = vi.mocked(resolveSquintDbPath);
const mockInitSessionState = vi.mocked(initSessionState);
const MockAgentBuilder = vi.mocked(AgentBuilder);

function createBaseOptions(overrides?: object) {
	return {
		client: {} as never,
		agentType: 'implementation',
		model: 'claude-sonnet-4',
		systemPrompt: 'You are a helpful assistant',
		maxIterations: 20,
		llmistLogger: {} as never,
		trackingContext: {
			metrics: { llmIterations: 0, gadgetCalls: 0 },
			syntheticInvocationIds: new Set<string>(),
			loopDetection: {
				previousIterationCalls: [],
				currentIterationCalls: [],
				repeatCount: 1,
				repeatedPattern: null,
				pendingWarning: null,
				nameOnlyRepeatCount: 1,
				pendingAction: null,
			},
		} as never,
		logWriter: vi.fn(),
		llmCallLogger: {} as never,
		repoDir: '/repo',
		gadgets: [] as never,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveSquintDbPath.mockReturnValue(null);

	// Reset all mock builder methods to return the builder instance
	for (const key of Object.keys(mockBuilderInstance)) {
		(mockBuilderInstance as Record<string, ReturnType<typeof vi.fn>>)[key].mockReturnValue(
			mockBuilderInstance,
		);
	}
});

// ============================================================================
// isSquintEnabled
// ============================================================================

describe('isSquintEnabled', () => {
	it('returns false when resolveSquintDbPath returns null', () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		expect(isSquintEnabled('/repo')).toBe(false);
	});

	it('returns true when resolveSquintDbPath returns a path', () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		expect(isSquintEnabled('/repo')).toBe(true);
	});
});

// ============================================================================
// createConfiguredBuilder
// ============================================================================

describe('createConfiguredBuilder', () => {
	it('creates an AgentBuilder with the given client', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(MockAgentBuilder).toHaveBeenCalledWith(options.client);
	});

	it('configures the model', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withModel).toHaveBeenCalledWith('claude-sonnet-4');
	});

	it('configures the system prompt', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withSystem).toHaveBeenCalledWith('You are a helpful assistant');
	});

	it('configures max iterations', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withMaxIterations).toHaveBeenCalledWith(20);
	});

	it('sets temperature to 0', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withTemperature).toHaveBeenCalledWith(0);
	});

	it('calls initSessionState when skipSessionState is not set', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith(
			'implementation',
			undefined,
			undefined,
			undefined,
		);
	});

	it('skips initSessionState when skipSessionState is true', () => {
		const options = createBaseOptions({ skipSessionState: true });
		createConfiguredBuilder(options);
		expect(mockInitSessionState).not.toHaveBeenCalled();
	});

	it('passes baseBranch, projectId, cardId to initSessionState', () => {
		const options = createBaseOptions({
			baseBranch: 'main',
			projectId: 'project-1',
			cardId: 'card-123',
		});
		createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith(
			'implementation',
			'main',
			'project-1',
			'card-123',
		);
	});

	it('calls withBudget when remainingBudgetUsd is positive', () => {
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).toHaveBeenCalledWith(5.0);
	});

	it('does not call withBudget when remainingBudgetUsd is undefined', () => {
		const options = createBaseOptions({ remainingBudgetUsd: undefined });
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).not.toHaveBeenCalled();
	});

	it('does not call withBudget when remainingBudgetUsd is 0', () => {
		const options = createBaseOptions({ remainingBudgetUsd: 0 });
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).not.toHaveBeenCalled();
	});

	it('handles BudgetPricingUnavailableError gracefully', () => {
		mockBuilderInstance.withBudget.mockImplementationOnce(() => {
			throw new BudgetPricingUnavailableError('Budget unavailable');
		});
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });

		// Should not throw
		expect(() => createConfiguredBuilder(options)).not.toThrow();
	});

	it('rethrows non-BudgetPricingUnavailableError errors from withBudget', () => {
		mockBuilderInstance.withBudget.mockImplementationOnce(() => {
			throw new Error('Unexpected budget error');
		});
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });

		expect(() => createConfiguredBuilder(options)).toThrow('Unexpected budget error');
	});

	it('calls postConfigure callback when provided', () => {
		const customBuilder = { ...mockBuilderInstance, custom: true };
		const postConfigure = vi.fn().mockReturnValue(customBuilder);
		const options = createBaseOptions({ postConfigure });

		const result = createConfiguredBuilder(options);

		expect(postConfigure).toHaveBeenCalled();
		expect(result).toBe(customBuilder);
	});

	it('does not call postConfigure when not provided', () => {
		const options = createBaseOptions({ postConfigure: undefined });

		// Should not throw and returns builder
		expect(() => createConfiguredBuilder(options)).not.toThrow();
	});

	it('returns a builder with max gadgets per response set', () => {
		const options = createBaseOptions();
		createConfiguredBuilder(options);
		expect(mockBuilderInstance.withMaxGadgetsPerResponse).toHaveBeenCalledWith(25);
	});
});
