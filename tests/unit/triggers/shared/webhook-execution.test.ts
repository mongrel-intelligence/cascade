import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so module-level constants are mocked
// ---------------------------------------------------------------------------

const {
	mockGetPersonaToken,
	mockInjectLlmApiKeys,
	mockRestoreLlmEnv,
	mockWithGitHubToken,
	mockWithCredentials,
	mockRunAgentExecutionPipeline,
} = vi.hoisted(() => {
	const mockRestoreLlmEnv = vi.fn();
	return {
		mockGetPersonaToken: vi.fn().mockResolvedValue('gh-token-xxx'),
		mockInjectLlmApiKeys: vi.fn().mockResolvedValue(mockRestoreLlmEnv),
		mockRestoreLlmEnv,
		mockWithGitHubToken: vi.fn().mockImplementation((_token, fn) => fn()),
		mockWithCredentials: vi.fn().mockImplementation((_projectId, fn) => fn()),
		mockRunAgentExecutionPipeline: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock('../../../../src/github/personas.js', () => ({
	getPersonaToken: mockGetPersonaToken,
}));

vi.mock('../../../../src/utils/llmEnv.js', () => ({
	injectLlmApiKeys: mockInjectLlmApiKeys,
}));

vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: mockWithGitHubToken,
}));

vi.mock('../../../../src/triggers/shared/agent-execution.js', () => ({
	runAgentExecutionPipeline: mockRunAgentExecutionPipeline,
}));

import { runAgentWithCredentials } from '../../../../src/triggers/shared/webhook-execution.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockIntegration = {
	type: 'trello',
	category: 'pm' as const,
	withCredentials: mockWithCredentials,
	hasIntegration: vi.fn().mockResolvedValue(true),
};

const PROJECT = {
	id: 'project-1',
	repo: 'acme/myapp',
	baseBranch: 'main',
	watchdogTimeoutMs: 120000,
} as unknown as Parameters<typeof runAgentWithCredentials>[2];

const CONFIG = {} as unknown as Parameters<typeof runAgentWithCredentials>[3];

function makeTriggerResult(agentType: string | null = 'implementation') {
	return {
		agentType,
		agentInput: { repoFullName: 'acme/myapp' },
		workItemId: 'card-abc',
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgentWithCredentials', () => {
	beforeEach(() => {
		mockRestoreLlmEnv.mockClear();
	});

	// -------------------------------------------------------------------------
	// Early return
	// -------------------------------------------------------------------------

	it('returns early without calling any nested functions when agentType is falsy', async () => {
		const result = makeTriggerResult(null);
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockGetPersonaToken).not.toHaveBeenCalled();
		expect(mockInjectLlmApiKeys).not.toHaveBeenCalled();
		expect(mockWithCredentials).not.toHaveBeenCalled();
		expect(mockWithGitHubToken).not.toHaveBeenCalled();
		expect(mockRunAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('returns early when agentType is an empty string', async () => {
		const result = makeTriggerResult('');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockGetPersonaToken).not.toHaveBeenCalled();
		expect(mockRunAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// GitHub token lookup uses resolved agent type
	// -------------------------------------------------------------------------

	it('calls getPersonaToken with the project id and resolved agentType', async () => {
		const result = makeTriggerResult('review');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockGetPersonaToken).toHaveBeenCalledWith('project-1', 'review');
	});

	it('passes the resolved token to withGitHubToken', async () => {
		mockGetPersonaToken.mockResolvedValueOnce('my-special-token');
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockWithGitHubToken).toHaveBeenCalledWith('my-special-token', expect.any(Function));
	});

	// -------------------------------------------------------------------------
	// Credential nesting order
	// -------------------------------------------------------------------------

	it('nests injectLlmApiKeys → integration.withCredentials → withGitHubToken → runAgentExecutionPipeline in that order', async () => {
		const callOrder: string[] = [];

		mockInjectLlmApiKeys.mockImplementationOnce(async () => {
			callOrder.push('injectLlmApiKeys');
			return mockRestoreLlmEnv;
		});

		mockWithCredentials.mockImplementationOnce(
			async (_projectId: string, fn: () => Promise<void>) => {
				callOrder.push('withCredentials');
				return fn();
			},
		);

		mockWithGitHubToken.mockImplementationOnce(async (_token: string, fn: () => Promise<void>) => {
			callOrder.push('withGitHubToken');
			return fn();
		});

		mockRunAgentExecutionPipeline.mockImplementationOnce(async () => {
			callOrder.push('runAgentExecutionPipeline');
		});

		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(callOrder).toEqual([
			'injectLlmApiKeys',
			'withCredentials',
			'withGitHubToken',
			'runAgentExecutionPipeline',
		]);
	});

	it('calls integration.withCredentials with the project id', async () => {
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockWithCredentials).toHaveBeenCalledWith('project-1', expect.any(Function));
	});

	it('calls runAgentExecutionPipeline with the trigger result, project, config, and resolved executionConfig', async () => {
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockRunAgentExecutionPipeline).toHaveBeenCalledWith(
			result,
			PROJECT,
			CONFIG,
			expect.objectContaining({ logLabel: 'trello agent' }),
		);
	});

	// -------------------------------------------------------------------------
	// executionConfig defaults
	// -------------------------------------------------------------------------

	it('uses a default executionConfig with logLabel derived from integration.type when none is provided', async () => {
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockRunAgentExecutionPipeline).toHaveBeenCalledWith(result, PROJECT, CONFIG, {
			logLabel: 'trello agent',
		});
	});

	it('passes explicit executionConfig through unchanged when provided', async () => {
		const customConfig = {
			logLabel: 'custom label',
			skipPrepareForAgent: true,
			skipHandleFailure: true,
		};
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG, customConfig);

		expect(mockRunAgentExecutionPipeline).toHaveBeenCalledWith(
			result,
			PROJECT,
			CONFIG,
			customConfig,
		);
	});

	it('does not merge the default executionConfig when an explicit one is passed', async () => {
		const customConfig = { logLabel: 'my-label' };
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG, customConfig);

		// Should be exactly the provided config, not { logLabel: 'trello agent', ...customConfig }
		expect(mockRunAgentExecutionPipeline).toHaveBeenCalledWith(
			result,
			PROJECT,
			CONFIG,
			customConfig,
		);
	});

	// -------------------------------------------------------------------------
	// LLM env restore — success path
	// -------------------------------------------------------------------------

	it('calls the LLM env restore function after successful execution', async () => {
		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG);

		expect(mockRestoreLlmEnv).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// LLM env restore — failure path
	// -------------------------------------------------------------------------

	it('calls the LLM env restore function even when runAgentExecutionPipeline throws', async () => {
		mockRunAgentExecutionPipeline.mockRejectedValueOnce(new Error('agent crashed'));

		const result = makeTriggerResult('implementation');
		await expect(
			runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG),
		).rejects.toThrow('agent crashed');

		expect(mockRestoreLlmEnv).toHaveBeenCalledOnce();
	});

	it('calls the LLM env restore function even when withCredentials throws', async () => {
		mockWithCredentials.mockRejectedValueOnce(new Error('credential error'));

		const result = makeTriggerResult('implementation');
		await expect(
			runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG),
		).rejects.toThrow('credential error');

		expect(mockRestoreLlmEnv).toHaveBeenCalledOnce();
	});

	it('calls the LLM env restore function even when withGitHubToken throws', async () => {
		mockWithGitHubToken.mockRejectedValueOnce(new Error('token error'));

		const result = makeTriggerResult('implementation');
		await expect(
			runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG),
		).rejects.toThrow('token error');

		expect(mockRestoreLlmEnv).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Error propagation
	// -------------------------------------------------------------------------

	it('re-throws errors from runAgentExecutionPipeline', async () => {
		mockRunAgentExecutionPipeline.mockRejectedValueOnce(new Error('pipeline failure'));

		const result = makeTriggerResult('implementation');
		await expect(
			runAgentWithCredentials(mockIntegration as never, result, PROJECT, CONFIG),
		).rejects.toThrow('pipeline failure');
	});

	// -------------------------------------------------------------------------
	// Integration type variants
	// -------------------------------------------------------------------------

	it('uses the integration type in the default logLabel (jira integration)', async () => {
		const jiraIntegration = {
			type: 'jira',
			category: 'pm' as const,
			withCredentials: mockWithCredentials,
			hasIntegration: vi.fn().mockResolvedValue(true),
		};

		const result = makeTriggerResult('implementation');
		await runAgentWithCredentials(jiraIntegration as never, result, PROJECT, CONFIG);

		expect(mockRunAgentExecutionPipeline).toHaveBeenCalledWith(result, PROJECT, CONFIG, {
			logLabel: 'jira agent',
		});
	});
});
