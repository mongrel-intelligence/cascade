import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all llmist SDK and internal dependencies
vi.mock('llmist', () => ({
	LLMist: vi.fn().mockImplementation(() => ({})),
	createLogger: vi.fn(() => ({})),
	type: undefined,
}));

vi.mock('../../../src/backends/agent-profiles.js', () => ({
	getAgentProfile: vi.fn(() => ({
		getLlmistGadgets: vi.fn(() => []),
	})),
}));

vi.mock('../../../src/agents/shared/builderFactory.js', () => ({
	createConfiguredBuilder: vi.fn(() => ({
		ask: vi.fn(() => ({
			run: vi.fn(async function* () {}),
			getTree: vi.fn(() => null),
			injectUserMessage: vi.fn(),
		})),
	})),
}));

vi.mock('../../../src/agents/shared/syntheticCalls.js', () => ({
	injectSyntheticCall: vi.fn((builder) => builder),
}));

vi.mock('../../../src/agents/utils/agentLoop.js', () => ({
	runAgentLoop: vi.fn().mockResolvedValue({
		output: 'Agent completed',
		iterations: 3,
		gadgetCalls: 5,
		cost: 0.05,
		loopTerminated: false,
	}),
}));

vi.mock('../../../src/agents/utils/index.js', () => ({
	getLogLevel: vi.fn(() => 'info'),
}));

vi.mock('../../../src/agents/utils/logging.js', () => ({
	createAgentLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	})),
}));

vi.mock('../../../src/agents/utils/tracking.js', () => ({
	createTrackingContext: vi.fn(() => ({
		metrics: { llmIterations: 0, gadgetCalls: 0 },
		loopDetection: { repeatCount: 0, nameOnlyRepeatCount: 0 },
		syntheticInvocationIds: new Set(),
	})),
}));

vi.mock('../../../src/config/customModels.js', () => ({
	CUSTOM_MODELS: [],
}));

vi.mock('../../../src/utils/llmLogging.js', () => ({
	createLLMCallLogger: vi.fn(() => ({
		logDir: '/tmp',
		logRequest: vi.fn(),
		logResponse: vi.fn(),
		getLogFiles: vi.fn(() => []),
	})),
}));

vi.mock('../../../src/utils/prUrl.js', () => ({
	extractPRUrl: vi.fn((output: string) => {
		const m = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
		return m ? m[0] : undefined;
	}),
}));

import { runAgentLoop } from '../../../src/agents/utils/agentLoop.js';
import { LlmistBackend } from '../../../src/backends/llmist/index.js';
import type { AgentBackendInput } from '../../../src/backends/types.js';

const mockRunAgentLoop = vi.mocked(runAgentLoop);

function makeInput(agentType = 'implementation'): AgentBackendInput {
	return {
		agentType,
		project: {
			id: 'p1',
			name: 'P',
			repo: 'o/r',
			baseBranch: 'main',
		} as AgentBackendInput['project'],
		config: { defaults: {} } as AgentBackendInput['config'],
		repoDir: '/repo',
		systemPrompt: 'You are an agent.',
		taskPrompt: 'Implement feature X.',
		cliToolsDir: '/cli',
		availableTools: [],
		contextInjections: [],
		maxIterations: 10,
		model: 'claude-sonnet-4',
		progressReporter: { onIteration: async () => {}, onToolCall: () => {}, onText: () => {} },
		logWriter: () => {},
		agentInput: { cardId: 'c1' } as AgentBackendInput['agentInput'],
		runId: 'run-123',
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('LlmistBackend', () => {
	it('has name "llmist"', () => {
		const backend = new LlmistBackend();
		expect(backend.name).toBe('llmist');
	});

	it('supportsAgentType returns true for any type', () => {
		const backend = new LlmistBackend();
		expect(backend.supportsAgentType('implementation')).toBe(true);
		expect(backend.supportsAgentType('review')).toBe(true);
		expect(backend.supportsAgentType('anything')).toBe(true);
	});
});

describe('LlmistBackend.execute', () => {
	it('returns success when runAgentLoop completes normally', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});

		const backend = new LlmistBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.output).toBe('Done');
		expect(result.cost).toBe(0.1);
		expect(result.error).toBeUndefined();
	});

	it('returns failure when loop is terminated due to persistent loop', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'partial output',
			iterations: 10,
			gadgetCalls: 20,
			cost: 0.3,
			loopTerminated: true,
		});

		const backend = new LlmistBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('loop');
	});

	it('extracts PR URL from output when present', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Created PR: https://github.com/owner/repo/pull/42',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});

		const backend = new LlmistBackend();
		const result = await backend.execute(makeInput());

		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
	});

	it('injects context injections as synthetic calls', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});

		const { injectSyntheticCall } = await import('../../../src/agents/shared/syntheticCalls.js');
		const mockInjectSyntheticCall = vi.mocked(injectSyntheticCall);

		const input = makeInput();
		input.contextInjections = [
			{
				toolName: 'ReadWorkItem',
				params: { workItemId: 'c1' },
				result: 'card content',
				description: 'Work item',
			},
			{
				toolName: 'ListDirectory',
				params: { directoryPath: '.' },
				result: 'dir listing',
				description: 'Dir',
			},
		];

		const backend = new LlmistBackend();
		await backend.execute(input);

		expect(mockInjectSyntheticCall).toHaveBeenCalledTimes(2);
		expect(mockInjectSyntheticCall).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			expect.anything(),
			'ReadWorkItem',
			{ workItemId: 'c1' },
			'card content',
			'gc_readworkitem_0',
		);
		expect(mockInjectSyntheticCall).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			expect.anything(),
			'ListDirectory',
			{ directoryPath: '.' },
			'dir listing',
			'gc_listdirectory_1',
		);
	});

	it('passes model and maxIterations from input to createConfiguredBuilder', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});

		const { createConfiguredBuilder } = await import(
			'../../../src/agents/shared/builderFactory.js'
		);
		const mockCreateConfiguredBuilder = vi.mocked(createConfiguredBuilder);

		const input = makeInput();
		input.model = 'claude-3-5-sonnet-20241022';
		input.maxIterations = 25;

		const backend = new LlmistBackend();
		await backend.execute(input);

		expect(mockCreateConfiguredBuilder).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'claude-3-5-sonnet-20241022',
				maxIterations: 25,
			}),
		);
	});

	it('gets gadgets from the agent profile', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 1,
			gadgetCalls: 0,
			cost: 0.01,
			loopTerminated: false,
		});

		const { getAgentProfile } = await import('../../../src/backends/agent-profiles.js');
		const mockGetAgentProfile = vi.mocked(getAgentProfile);
		const mockGetLlmistGadgets = vi.fn().mockReturnValue([]);
		mockGetAgentProfile.mockReturnValue({
			getLlmistGadgets: mockGetLlmistGadgets,
		} as ReturnType<typeof getAgentProfile>);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('review'));

		expect(mockGetAgentProfile).toHaveBeenCalledWith('review');
		expect(mockGetLlmistGadgets).toHaveBeenCalledWith('review');
	});
});
