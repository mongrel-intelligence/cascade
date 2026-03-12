import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all llmist SDK and internal dependencies
vi.mock('llmist', () => ({
	LLMist: vi.fn().mockImplementation(() => ({})),
	createLogger: vi.fn(() => ({})),
}));

// Mock capabilities module to avoid gadget imports
vi.mock('../../../src/agents/capabilities/index.js', () => ({
	createIntegrationChecker: vi.fn(async () => () => true),
}));

// Mock agents/definitions to break the circular dependency chain:
// backends/llmist → definitions → strategies → gadgets → pm/ → webhook-handler
// → triggers/agent-execution → agents/registry → new LlmistEngine() (still loading)
vi.mock('../../../src/agents/definitions/index.js', () => ({
	loadAgentDefinition: vi.fn(() => ({ engine: {} })),
	resolveAgentDefinition: vi.fn(async () => ({ engine: {} })),
}));

vi.mock('../../../src/agents/definitions/profiles.js', () => ({
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

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(() => ({
		prUrl: null,
	})),
}));

import { runAgentLoop } from '../../../src/agents/utils/agentLoop.js';
import { LlmistEngine } from '../../../src/backends/llmist/index.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockGetSessionState = vi.mocked(getSessionState);

function makeInput(agentType = 'implementation'): AgentExecutionPlan {
	return {
		agentType,
		project: {
			id: 'p1',
			name: 'P',
			repo: 'o/r',
			baseBranch: 'main',
		} as AgentExecutionPlan['project'],
		config: { defaults: {} } as AgentExecutionPlan['config'],
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
		agentInput: { workItemId: 'c1' } as AgentExecutionPlan['agentInput'],
		runId: 'run-123',
		engineLogPath: '/workspace/llmist-implementation-12345.log',
	};
}

describe('LlmistEngine', () => {
	it('has engine id "llmist"', () => {
		const engine = new LlmistEngine();
		expect(engine.definition.id).toBe('llmist');
	});

	it('supportsAgentType returns true for any type', () => {
		const engine = new LlmistEngine();
		expect(engine.supportsAgentType('implementation')).toBe(true);
		expect(engine.supportsAgentType('review')).toBe(true);
		expect(engine.supportsAgentType('anything')).toBe(true);
	});
});

describe('LlmistEngine.execute', () => {
	beforeEach(() => {
		mockGetSessionState.mockReturnValue({ prUrl: null } as ReturnType<typeof getSessionState>);
	});

	it('returns success when runAgentLoop completes normally', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});

		const engine = new LlmistEngine();
		const result = await engine.execute(makeInput());

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

		const engine = new LlmistEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toContain('loop');
	});

	it('reads prUrl from session state regardless of agent output text', async () => {
		// Reproduces the false positive from run 1391506b: the CreatePR gadget
		// recorded the URL in session state, but the LLM didn't echo it in output.
		mockRunAgentLoop.mockResolvedValue({
			output: 'All done, PR created successfully.',
			iterations: 9,
			gadgetCalls: 12,
			cost: 0.15,
			loopTerminated: false,
		});
		mockGetSessionState.mockReturnValue({
			prUrl: 'https://github.com/owner/repo/pull/42',
		} as ReturnType<typeof getSessionState>);

		const engine = new LlmistEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
	});

	it('returns undefined prUrl when no PR was created', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 5,
			gadgetCalls: 8,
			cost: 0.1,
			loopTerminated: false,
		});
		// Session state has prUrl: null (default from beforeEach)

		const engine = new LlmistEngine();
		const result = await engine.execute(makeInput());

		expect(result.prUrl).toBeUndefined();
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

		const engine = new LlmistEngine();
		await engine.execute(input);

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

		const engine = new LlmistEngine();
		await engine.execute(input);

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

		const { getAgentProfile } = await import('../../../src/agents/definitions/profiles.js');
		const mockGetAgentProfile = vi.mocked(getAgentProfile);
		const mockGetLlmistGadgets = vi.fn().mockReturnValue([]);
		mockGetAgentProfile.mockReturnValue({
			getLlmistGadgets: mockGetLlmistGadgets,
		} as ReturnType<typeof getAgentProfile>);

		const engine = new LlmistEngine();
		await engine.execute(makeInput('review'));

		expect(mockGetAgentProfile).toHaveBeenCalledWith('review');
		// getLlmistGadgets no longer takes an argument - gadgets are pre-built in profile
		expect(mockGetLlmistGadgets).toHaveBeenCalled();
	});

	it('sets LLMIST_LOG_FILE to the provided engineLogPath', async () => {
		mockRunAgentLoop.mockResolvedValue({
			output: 'Done',
			iterations: 1,
			gadgetCalls: 0,
			cost: 0.01,
			loopTerminated: false,
		});

		const input = makeInput();
		input.engineLogPath = '/workspace/test-llmist.log';

		const engine = new LlmistEngine();
		await engine.execute(input);

		expect(process.env.LLMIST_LOG_FILE).toBe('/workspace/test-llmist.log');
		expect(process.env.LLMIST_LOG_TEE).toBe('true');
	});

	it('passes progressReporter to createConfiguredBuilder as progressMonitor', async () => {
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

		const mockProgressReporter = {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onToolCall: vi.fn(),
			onText: vi.fn(),
		};

		const input = makeInput();
		input.progressReporter = mockProgressReporter;

		const engine = new LlmistEngine();
		await engine.execute(input);

		expect(mockCreateConfiguredBuilder).toHaveBeenCalledWith(
			expect.objectContaining({
				progressMonitor: mockProgressReporter,
			}),
		);
	});
});
