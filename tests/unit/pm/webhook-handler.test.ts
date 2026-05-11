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

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
}));

import { loadProjectConfigById } from '../../../src/config/provider.js';
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
		watchdogTimeoutMs: 120000,
	};
	const mockConfig = {
		projects: [],
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
		expect(checkAgentTypeConcurrency).toHaveBeenCalledWith(
			'project-1',
			'implementation',
			'trello webhook',
			'card-abc',
		);
	});

	it('calls withCredentials on integration during execution', async () => {
		const integration = createMockIntegration();
		const registry = createMockRegistry();

		await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

		expect(integration.withCredentials).toHaveBeenCalled();
	});

	// 2026-05-11: preferredProjectId path. Closes the third bug in the
	// chain (#1332, #1337 fixed the router; this fixes the worker-side
	// re-resolution). When the router has already chosen the correct
	// cascade project (e.g. two cascade projects share a Linear team and
	// the issue's Linear Project determines which one) it forwards the
	// chosen id through the job → webhook-handler → processPMWebhook.
	// processPMWebhook must use the router's choice, NOT re-look-up by
	// webhook identifier (which would re-introduce the `.find()` shadow).
	describe('preferredProjectId (router-selected project)', () => {
		const routerSelectedProject = {
			id: 'ucho',
			name: 'ucho project',
			repo: 'zbigniewsobiecki/ucho',
			baseBranch: 'main',
			watchdogTimeoutMs: 120000,
		};
		const routerSelectedConfig = { projects: [] };

		beforeEach(() => {
			vi.mocked(loadProjectConfigById).mockResolvedValue({
				project: routerSelectedProject,
				config: routerSelectedConfig,
			} as never);
		});

		it('uses loadProjectConfigById when preferredProjectId is set, NOT integration.lookupProject', async () => {
			const integration = createMockIntegration();
			const registry = createMockRegistry();

			await processPMWebhook(
				integration as never,
				{ type: 'card_moved' },
				registry as never,
				undefined,
				undefined,
				'ucho',
			);

			expect(loadProjectConfigById).toHaveBeenCalledWith('ucho');
			expect(integration.lookupProject).not.toHaveBeenCalled();
		});

		it('agent execution receives the router-selected project (ucho), not the lookupProject default', async () => {
			const integration = createMockIntegration();
			const registry = createMockRegistry();

			await processPMWebhook(
				integration as never,
				{ type: 'card_moved' },
				registry as never,
				undefined,
				undefined,
				'ucho',
			);

			// withCredentials receives the project.id from the resolved config.
			// Pre-fix this was the lookupProject default ('project-1' from
			// the mock integration); post-fix it's the router's selection.
			expect(integration.withCredentials).toHaveBeenCalledWith('ucho', expect.any(Function));
		});

		it('falls back to integration.lookupProject when preferredProjectId is undefined (legacy callers)', async () => {
			const integration = createMockIntegration();
			const registry = createMockRegistry();

			await processPMWebhook(integration as never, { type: 'card_moved' }, registry as never);

			expect(loadProjectConfigById).not.toHaveBeenCalled();
			expect(integration.lookupProject).toHaveBeenCalledWith('BOARD_123');
		});

		it('returns early when preferredProjectId resolves to no project (fail-closed)', async () => {
			vi.mocked(loadProjectConfigById).mockResolvedValueOnce(undefined);
			const integration = createMockIntegration();
			const registry = createMockRegistry();

			await processPMWebhook(
				integration as never,
				{ type: 'card_moved' },
				registry as never,
				undefined,
				undefined,
				'never-configured-project',
			);

			expect(registry.dispatch).not.toHaveBeenCalled();
			expect(mockRunAgentExecutionPipeline).not.toHaveBeenCalled();
		});
	});
});
