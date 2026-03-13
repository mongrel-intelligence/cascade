import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/squintDb.js', () => ({
	resolveSquintDbPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/config/compactionConfig.js', () => ({
	getCompactionConfig: vi.fn().mockReturnValue({ maxTokens: 100000, strategy: 'hybrid' }),
}));

vi.mock('../../../../src/config/hintConfig.js', () => ({
	getIterationTrailingMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/config/rateLimits.js', () => ({
	getRateLimitForModel: vi.fn().mockReturnValue({ rpm: 60, tpm: 100000 }),
}));

vi.mock('../../../../src/config/retryConfig.js', () => ({
	getRetryConfig: vi.fn().mockReturnValue({ maxRetries: 3 }),
}));

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		initSessionState: vi.fn(),
		setReadOnlyFs: vi.fn(),
	};
});

vi.mock('../../../../src/agents/shared/capabilities.js', () => ({
	getAgentCapabilities: vi.fn().mockResolvedValue({
		canEditFiles: true,
		canCreatePR: true,
		canUpdateChecklists: true,
		isReadOnly: false,
	}),
}));

vi.mock('node:child_process', () => ({
	execSync: vi.fn().mockReturnValue('abc123headsha\n'),
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
	withCaching: vi.fn(),
	withHooks: vi.fn(),
	withGadgets: vi.fn(),
	withMaxGadgetsPerResponse: vi.fn(),
	withBudget: vi.fn(),
	withGadgetExecutionMode: vi.fn(),
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

import { execSync } from 'node:child_process';
import { AgentBuilder, BudgetPricingUnavailableError } from 'llmist';
import {
	createConfiguredBuilder,
	isSquintEnabled,
} from '../../../../src/agents/shared/builderFactory.js';
import { getAgentCapabilities } from '../../../../src/agents/shared/capabilities.js';
import { initSessionState, setReadOnlyFs } from '../../../../src/gadgets/sessionState.js';
import { resolveSquintDbPath } from '../../../../src/utils/squintDb.js';

const mockExecSync = vi.mocked(execSync);
const mockResolveSquintDbPath = vi.mocked(resolveSquintDbPath);
const mockInitSessionState = vi.mocked(initSessionState);
const mockSetReadOnlyFs = vi.mocked(setReadOnlyFs);
const mockGetAgentCapabilities = vi.mocked(getAgentCapabilities);
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
	it('creates an AgentBuilder with the given client', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(MockAgentBuilder).toHaveBeenCalledWith(options.client);
	});

	it('configures the model', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withModel).toHaveBeenCalledWith('claude-sonnet-4');
	});

	it('configures the system prompt', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withSystem).toHaveBeenCalledWith('You are a helpful assistant');
	});

	it('configures max iterations', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withMaxIterations).toHaveBeenCalledWith(20);
	});

	it('sets temperature to 0', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withTemperature).toHaveBeenCalledWith(0);
	});

	it('enables token caching', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withCaching).toHaveBeenCalled();
	});

	it('calls initSessionState when skipSessionState is not set', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith({
			agentType: 'implementation',
			baseBranch: undefined,
			projectId: undefined,
			workItemId: undefined,
			hooks: undefined,
			workItemUrl: undefined,
			workItemTitle: undefined,
			initialHeadSha: 'abc123headsha',
		});
	});

	it('skips initSessionState when skipSessionState is true', async () => {
		const options = createBaseOptions({ skipSessionState: true });
		await createConfiguredBuilder(options);
		expect(mockInitSessionState).not.toHaveBeenCalled();
	});

	it('passes baseBranch, projectId, workItemId to initSessionState', async () => {
		const options = createBaseOptions({
			baseBranch: 'main',
			projectId: 'project-1',
			workItemId: 'card-123',
		});
		await createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'project-1',
			workItemId: 'card-123',
			hooks: undefined,
			workItemUrl: undefined,
			workItemTitle: undefined,
			initialHeadSha: 'abc123headsha',
		});
	});

	it('passes workItemUrl and workItemTitle to initSessionState', async () => {
		const options = createBaseOptions({
			baseBranch: 'main',
			projectId: 'project-1',
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/abc123',
			workItemTitle: 'My Feature Card',
		});
		await createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'project-1',
			workItemId: 'card-123',
			hooks: undefined,
			workItemUrl: 'https://trello.com/c/abc123',
			workItemTitle: 'My Feature Card',
			initialHeadSha: 'abc123headsha',
		});
	});

	it('passes undefined initialHeadSha when git rev-parse fails', async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('not a git repository');
		});
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockInitSessionState).toHaveBeenCalledWith({
			agentType: 'implementation',
			baseBranch: undefined,
			projectId: undefined,
			workItemId: undefined,
			hooks: undefined,
			workItemUrl: undefined,
			workItemTitle: undefined,
			initialHeadSha: undefined,
		});
	});

	it('calls withBudget when remainingBudgetUsd is positive', async () => {
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).toHaveBeenCalledWith(5.0);
	});

	it('does not call withBudget when remainingBudgetUsd is undefined', async () => {
		const options = createBaseOptions({ remainingBudgetUsd: undefined });
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).not.toHaveBeenCalled();
	});

	it('does not call withBudget when remainingBudgetUsd is 0', async () => {
		const options = createBaseOptions({ remainingBudgetUsd: 0 });
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withBudget).not.toHaveBeenCalled();
	});

	it('handles BudgetPricingUnavailableError gracefully', async () => {
		mockBuilderInstance.withBudget.mockImplementationOnce(() => {
			throw new BudgetPricingUnavailableError('Budget unavailable');
		});
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });

		// Should not throw
		await expect(createConfiguredBuilder(options)).resolves.not.toThrow();
	});

	it('rethrows non-BudgetPricingUnavailableError errors from withBudget', async () => {
		mockBuilderInstance.withBudget.mockImplementationOnce(() => {
			throw new Error('Unexpected budget error');
		});
		const options = createBaseOptions({ remainingBudgetUsd: 5.0 });

		await expect(createConfiguredBuilder(options)).rejects.toThrow('Unexpected budget error');
	});

	it('calls withGadgetExecutionMode with sequential unconditionally', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withGadgetExecutionMode).toHaveBeenCalledWith('sequential');
	});

	it('returns a builder with max gadgets per response set', async () => {
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockBuilderInstance.withMaxGadgetsPerResponse).toHaveBeenCalledWith(25);
	});

	it('calls setReadOnlyFs(true) when agent is read-only', async () => {
		mockGetAgentCapabilities.mockResolvedValueOnce({
			canEditFiles: false,
			canCreatePR: false,
			canUpdateChecklists: false,
			isReadOnly: true,
		});
		const options = createBaseOptions({ agentType: 'review' });
		await createConfiguredBuilder(options);
		expect(mockSetReadOnlyFs).toHaveBeenCalledWith(true);
	});

	it('does not call setReadOnlyFs when agent has write access', async () => {
		mockGetAgentCapabilities.mockResolvedValueOnce({
			canEditFiles: true,
			canCreatePR: true,
			canUpdateChecklists: true,
			isReadOnly: false,
		});
		const options = createBaseOptions();
		await createConfiguredBuilder(options);
		expect(mockSetReadOnlyFs).not.toHaveBeenCalled();
	});

	it('does not call setReadOnlyFs when skipSessionState is true', async () => {
		const options = createBaseOptions({ skipSessionState: true });
		await createConfiguredBuilder(options);
		expect(mockSetReadOnlyFs).not.toHaveBeenCalled();
	});
});
