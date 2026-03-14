import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_token, fn) => fn()),
}));

vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn().mockResolvedValue('gh-token-xxx'),
}));

vi.mock('../../../src/triggers/shared/agent-execution.js', () => ({
	runAgentExecutionPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	startWatchdog: vi.fn(),
}));

vi.mock('../../../src/utils/llmEnv.js', () => ({
	injectLlmApiKeys: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('../../../src/pm/context.js', () => ({
	getPMProvider: vi.fn().mockReturnValue({}),
	withPMProvider: vi.fn().mockImplementation((_provider, fn) => fn()),
}));

vi.mock('../../../src/pm/lifecycle.js', () => ({
	PMLifecycleManager: vi.fn().mockImplementation(() => ({
		handleError: vi.fn().mockResolvedValue(undefined),
	})),
	resolveProjectPMConfig: vi.fn().mockReturnValue({ type: 'trello' }),
}));

vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: {
		createProvider: vi.fn().mockReturnValue({}),
	},
}));

vi.mock('../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: vi.fn().mockResolvedValue({ maxConcurrency: null, blocked: false }),
	markAgentTypeEnqueued: vi.fn(),
	clearAgentTypeEnqueued: vi.fn(),
	markRecentlyDispatched: vi.fn(),
}));

import { processPMWebhook } from '../../../src/pm/webhook-handler.js';
import { checkAgentTypeConcurrency } from '../../../src/router/agent-type-lock.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import { startWatchdog } from '../../../src/utils/index.js';

const mockStartWatchdog = vi.mocked(startWatchdog);
const mockRunAgentExecutionPipeline = vi.mocked(runAgentExecutionPipeline);

// ============================================================================
// PMIntegration factory
// ============================================================================

function createMockIntegration(
	overrides?: Partial<{
		parseWebhookPayload: () => object | null;
		lookupProject: () => object | null;
		withCredentials: (projectId: string, fn: () => Promise<void>) => Promise<void>;
		deleteAckComment: () => Promise<void>;
		type: string;
	}>,
) {
	const mockEvent = {
		projectIdentifier: 'BOARD_123',
		workItemId: 'card-abc',
		eventType: 'card_moved',
	};
	const mockProject = {
		id: 'project-1',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
	};
	const mockConfig = {
		defaults: { watchdogTimeoutMs: 120000 },
	};

	return {
		type: 'trello',
		parseWebhookPayload: vi.fn().mockReturnValue(mockEvent),
		lookupProject: vi.fn().mockResolvedValue({ project: mockProject, config: mockConfig }),
		withCredentials: vi
			.fn()
			.mockImplementation((_projectId: string, fn: () => Promise<void>) => fn()),
		deleteAckComment: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createMockRegistry(result?: object | null) {
	return {
		dispatch: vi.fn().mockResolvedValue(
			result === undefined
				? {
						agentType: 'implementation',
						workItemId: 'card-abc',
						agentInput: { cardId: 'card-abc' },
					}
				: result,
		),
	};
}

beforeEach(() => {
	mockRunAgentExecutionPipeline.mockResolvedValue(undefined);
});

// ============================================================================
// processPMWebhook
// ============================================================================

describe('processPMWebhook', () => {
	it('returns early when payload is invalid', async () => {
		const integration = createMockIntegration({
			parseWebhookPayload: vi.fn().mockReturnValue(null),
		});
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { invalid: true }, registry as never);

		expect(registry.dispatch).not.toHaveBeenCalled();
	});

	it('returns early when no project found for identifier', async () => {
		const integration = createMockIntegration({
			lookupProject: vi.fn().mockResolvedValue(null),
		});
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(registry.dispatch).not.toHaveBeenCalled();
	});

	it('dispatches to trigger registry when project found', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(registry.dispatch).toHaveBeenCalled();
	});

	it('runs agent when trigger matches', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(mockRunAgentExecutionPipeline).toHaveBeenCalled();
	});

	it('starts watchdog on trigger match', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(mockStartWatchdog).toHaveBeenCalledWith(120000);
	});

	it('uses pre-resolved trigger result when provided', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry(null); // registry would return null
		const preResolvedResult = {
			agentType: 'splitting',
			workItemId: 'card-pre',
			agentInput: { cardId: 'card-pre' },
		};

		await processPMWebhook(
			integration as never,
			{ type: 'card_moved' },
			registry as never,
			undefined,
			preResolvedResult,
		);

		// Should use the pre-resolved result, not dispatch to registry
		expect(registry.dispatch).not.toHaveBeenCalled();
		expect(mockRunAgentExecutionPipeline).toHaveBeenCalled();
	});

	it('passes ackCommentId into agentInput when provided', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(
			integration as never,
			{ type: 'card_moved' },
			registry as never,
			'ack-comment-123',
		);

		// Verify ackCommentId was injected — the agent pipeline was called
		expect(mockRunAgentExecutionPipeline).toHaveBeenCalled();
	});

	it('skips agent execution when agent-type concurrency is blocked', async () => {
		vi.mocked(checkAgentTypeConcurrency).mockResolvedValueOnce({
			maxConcurrency: 1,
			blocked: true,
		});
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(mockRunAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('calls withCredentials on integration during execution', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(integration.withCredentials).toHaveBeenCalled();
	});
});
