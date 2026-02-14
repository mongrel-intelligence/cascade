import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/base.js', () => ({
	executeAgent: vi.fn(),
}));

vi.mock('../../../src/agents/respond-to-review.js', () => ({
	executeRespondToReviewAgent: vi.fn(),
}));

vi.mock('../../../src/agents/respond-to-ci.js', () => ({
	executeRespondToCIAgent: vi.fn(),
}));

vi.mock('../../../src/agents/respond-to-pr-comment.js', () => ({
	executeRespondToPRCommentAgent: vi.fn(),
}));

vi.mock('../../../src/agents/review.js', () => ({
	executeReviewAgent: vi.fn(),
}));

import { executeAgent } from '../../../src/agents/base.js';
import { executeRespondToCIAgent } from '../../../src/agents/respond-to-ci.js';
import { executeRespondToPRCommentAgent } from '../../../src/agents/respond-to-pr-comment.js';
import { executeRespondToReviewAgent } from '../../../src/agents/respond-to-review.js';
import { executeReviewAgent } from '../../../src/agents/review.js';
import { LlmistBackend } from '../../../src/backends/llmist/index.js';
import type { AgentBackendInput } from '../../../src/backends/types.js';

const mockExecuteAgent = vi.mocked(executeAgent);
const mockRespondToReview = vi.mocked(executeRespondToReviewAgent);
const mockRespondToCI = vi.mocked(executeRespondToCIAgent);
const mockRespondToPRComment = vi.mocked(executeRespondToPRCommentAgent);
const mockReviewAgent = vi.mocked(executeReviewAgent);

function makeInput(agentType: string): AgentBackendInput {
	return {
		agentType,
		project: { id: 'test', name: 'Test', repo: 'o/r' } as AgentBackendInput['project'],
		config: { defaults: {} } as AgentBackendInput['config'],
		repoDir: '',
		systemPrompt: '',
		taskPrompt: '',
		cliToolsDir: '',
		availableTools: [],
		contextInjections: [],
		maxIterations: 0,
		model: '',
		progressReporter: { onIteration: async () => {}, onToolCall: () => {}, onText: () => {} },
		logWriter: () => {},
		agentInput: { cardId: 'c1' } as AgentBackendInput['agentInput'],
	};
}

const agentResult = {
	success: true,
	output: 'Done',
	prUrl: 'https://github.com/o/r/pull/1',
	error: undefined,
	cost: 0.05,
	logBuffer: Buffer.from('log'),
};

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

describe('execute', () => {
	it('delegates to executeAgent for generic types', async () => {
		mockExecuteAgent.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		const result = await backend.execute(makeInput('implementation'));

		expect(mockExecuteAgent).toHaveBeenCalledWith('implementation', expect.any(Object));
		expect(result.success).toBe(true);
		expect(result.output).toBe('Done');
	});

	it('delegates to executeAgent for briefing', async () => {
		mockExecuteAgent.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('briefing'));

		expect(mockExecuteAgent).toHaveBeenCalledWith('briefing', expect.any(Object));
	});

	it('delegates to specialized executor for respond-to-review', async () => {
		mockRespondToReview.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('respond-to-review'));

		expect(mockRespondToReview).toHaveBeenCalled();
		expect(mockExecuteAgent).not.toHaveBeenCalled();
	});

	it('delegates to specialized executor for respond-to-ci', async () => {
		mockRespondToCI.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('respond-to-ci'));

		expect(mockRespondToCI).toHaveBeenCalled();
	});

	it('delegates to specialized executor for respond-to-pr-comment', async () => {
		mockRespondToPRComment.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('respond-to-pr-comment'));

		expect(mockRespondToPRComment).toHaveBeenCalled();
	});

	it('delegates to specialized executor for review', async () => {
		mockReviewAgent.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		await backend.execute(makeInput('review'));

		expect(mockReviewAgent).toHaveBeenCalled();
	});

	it('maps AgentResult fields to AgentBackendResult', async () => {
		mockExecuteAgent.mockResolvedValue(agentResult);

		const backend = new LlmistBackend();
		const result = await backend.execute(makeInput('planning'));

		expect(result).toEqual({
			success: true,
			output: 'Done',
			prUrl: 'https://github.com/o/r/pull/1',
			error: undefined,
			cost: 0.05,
			logBuffer: Buffer.from('log'),
		});
	});
});
