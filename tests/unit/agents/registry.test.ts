import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock backend modules before importing the registry
vi.mock('../../../src/backends/index.js', () => ({
	resolveBackendName: vi.fn(),
	getBackend: vi.fn(),
	getRegisteredBackends: vi.fn(),
	registerBackend: vi.fn(),
	executeWithBackend: vi.fn(),
	LlmistBackend: vi.fn().mockImplementation(() => ({
		name: 'llmist',
		execute: vi.fn(),
		supportsAgentType: vi.fn().mockReturnValue(true),
	})),
	ClaudeCodeBackend: vi.fn().mockImplementation(() => ({
		name: 'claude-code',
		execute: vi.fn(),
		supportsAgentType: vi.fn().mockReturnValue(true),
	})),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { runAgent } from '../../../src/agents/registry.js';
import {
	executeWithBackend,
	getBackend,
	getRegisteredBackends,
	resolveBackendName,
} from '../../../src/backends/index.js';
import type { AgentBackend } from '../../../src/backends/types.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

const mockResolveBackendName = vi.mocked(resolveBackendName);
const mockGetBackend = vi.mocked(getBackend);
const mockGetRegisteredBackends = vi.mocked(getRegisteredBackends);
const mockExecuteWithBackend = vi.mocked(executeWithBackend);

function makeInput(): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		cardId: 'card1',
		project: {
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			githubTokenEnv: 'GITHUB_TOKEN',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		},
		config: {
			defaults: {
				model: 'test-model',
				agentModels: {},
				maxIterations: 50,
				agentIterations: {},
				freshMachineTimeoutMs: 300000,
				watchdogTimeoutMs: 1800000,
				postJobGracePeriodMs: 5000,
				cardBudgetUsd: 3.5,
				agentBackend: 'llmist',
				progressModel: 'openrouter:google/gemini-2.5-flash-lite',
				progressIntervalMinutes: 5,
			},
			projects: [],
		},
	} as AgentInput & { project: ProjectConfig; config: CascadeConfig };
}

function makeMockBackend(name: string, supportsAll = true): AgentBackend {
	return {
		name,
		execute: vi.fn().mockResolvedValue({ success: true, output: 'Done' }),
		supportsAgentType: vi.fn().mockReturnValue(supportsAll),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('runAgent', () => {
	it('resolves backend name from config', async () => {
		const backend = makeMockBackend('llmist');
		mockResolveBackendName.mockReturnValue('llmist');
		mockGetBackend.mockReturnValue(backend);

		await runAgent('implementation', makeInput());

		expect(mockResolveBackendName).toHaveBeenCalledWith(
			'implementation',
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('returns error when backend not found (lists registered backends)', async () => {
		mockResolveBackendName.mockReturnValue('unknown-backend');
		mockGetBackend.mockReturnValue(undefined);
		mockGetRegisteredBackends.mockReturnValue(['llmist']);

		const result = await runAgent('implementation', makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('Unknown agent backend: "unknown-backend"');
		expect(result.error).toContain('llmist');
	});

	it('returns error when backend does not support agent type', async () => {
		const backend = makeMockBackend('custom', false);
		mockResolveBackendName.mockReturnValue('custom');
		mockGetBackend.mockReturnValue(backend);

		const result = await runAgent('implementation', makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('does not support agent type "implementation"');
	});

	it('for llmist: calls backend.execute with minimal input + agentInput', async () => {
		const backend = makeMockBackend('llmist');
		mockResolveBackendName.mockReturnValue('llmist');
		mockGetBackend.mockReturnValue(backend);

		await runAgent('implementation', makeInput());

		expect(backend.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				repoDir: '',
				systemPrompt: '',
				availableTools: [],
				contextInjections: [],
			}),
		);
		expect(mockExecuteWithBackend).not.toHaveBeenCalled();
	});

	it('for non-llmist: calls executeWithBackend with full lifecycle', async () => {
		const backend = makeMockBackend('claude-code');
		mockResolveBackendName.mockReturnValue('claude-code');
		mockGetBackend.mockReturnValue(backend);
		mockExecuteWithBackend.mockResolvedValue({
			success: true,
			output: 'Done via adapter',
		});

		const input = makeInput();
		const result = await runAgent('implementation', input);

		expect(mockExecuteWithBackend).toHaveBeenCalledWith(backend, 'implementation', input);
		expect(backend.execute).not.toHaveBeenCalled();
		expect(result.output).toBe('Done via adapter');
	});
});
