import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTextComplete = vi.fn();
vi.mock('llmist', async (importOriginal) => ({
	...(await importOriginal<typeof import('llmist')>()),
	LLMist: vi.fn().mockImplementation(() => ({
		text: { complete: mockTextComplete },
	})),
}));

// Mock agentMessages to avoid requiring initAgentMessages() in tests
vi.mock('../../../src/config/agentMessages.js', () => ({
	AGENT_LABELS: {
		implementation: { emoji: '🧑‍💻', label: 'Implementation Update' },
		review: { emoji: '🔍', label: 'Code Review Update' },
		splitting: { emoji: '📋', label: 'Splitting Update' },
	},
	AGENT_ROLE_HINTS: {
		implementation: 'Writes code, runs tests, and prepares a pull request',
		review: 'Reviews pull request changes for quality and correctness',
		splitting: 'Breaks down a feature plan into smaller, ordered work items (subtasks)',
	},
	INITIAL_MESSAGES: {},
	getAgentLabel: vi.fn((agentType: string) => {
		const labels: Record<string, { emoji: string; label: string }> = {
			implementation: { emoji: '🧑‍💻', label: 'Implementation Update' },
			review: { emoji: '🔍', label: 'Code Review Update' },
			splitting: { emoji: '📋', label: 'Splitting Update' },
		};
		return labels[agentType] ?? { emoji: '⚙️', label: 'Progress Update' };
	}),
}));

import { LLMist } from 'llmist';
import { type ProgressContext, callProgressModel } from '../../../src/backends/progressModel.js';

const MockLLMist = vi.mocked(LLMist);

function makeContext(overrides: Partial<ProgressContext> = {}): ProgressContext {
	return {
		agentType: 'implementation',
		taskDescription: 'Implement the feature',
		elapsedMinutes: 5,
		iteration: 3,
		maxIterations: 20,
		todos: [],
		recentToolCalls: [],
		...overrides,
	};
}

describe('callProgressModel', () => {
	it('returns text output from LLM on success', async () => {
		mockTextComplete.mockResolvedValue(
			'**🚀 Implementation Update** (5 min)\n\nWorking on the feature.',
		);

		const result = await callProgressModel('test-model', makeContext(), []);
		expect(result).toBe('**🚀 Implementation Update** (5 min)\n\nWorking on the feature.');
	});

	it('returns trimmed output', async () => {
		mockTextComplete.mockResolvedValue('  Output with whitespace.  ');

		const result = await callProgressModel('test-model', makeContext(), []);
		expect(result).toBe('Output with whitespace.');
	});

	it('throws when LLM returns empty output on both attempts', async () => {
		mockTextComplete.mockResolvedValue('');

		await expect(callProgressModel('test-model', makeContext(), [])).rejects.toThrow(
			'Progress model returned empty output',
		);
	});

	it('throws when LLM returns whitespace-only output on both attempts', async () => {
		mockTextComplete.mockResolvedValue('   ');

		await expect(callProgressModel('test-model', makeContext(), [])).rejects.toThrow(
			'Progress model returned empty output',
		);
	});

	it('retries once on empty output and succeeds', async () => {
		mockTextComplete.mockResolvedValueOnce('').mockResolvedValueOnce('Recovered progress update.');

		const result = await callProgressModel('test-model', makeContext(), []);
		expect(result).toBe('Recovered progress update.');
		expect(MockLLMist).toHaveBeenCalledTimes(2);
	});

	it('throws when LLM call times out (races against a slow call)', async () => {
		let rejectFn!: (err: Error) => void;
		const hangPromise = new Promise<never>((_res, rej) => {
			rejectFn = rej;
		});

		mockTextComplete.mockReturnValue(hangPromise);

		const callPromise = callProgressModel('test-model', makeContext(), []);

		// Trigger the hang to fail fast with a timeout-like error
		rejectFn(new Error('Progress model call timed out'));

		await expect(callPromise).rejects.toThrow('Progress model call timed out');
	});

	it('rejects before timeout when LLM throws', async () => {
		mockTextComplete.mockRejectedValue(new Error('LLM network error'));

		await expect(callProgressModel('test-model', makeContext(), [])).rejects.toThrow(
			'LLM network error',
		);
	});

	it('does not use AgentBuilder — uses client.text.complete() directly', async () => {
		mockTextComplete.mockResolvedValue('Output.');

		await callProgressModel('test-model', makeContext(), []);
		expect(mockTextComplete).toHaveBeenCalledTimes(1);
		expect(MockLLMist).toHaveBeenCalledTimes(1);
	});

	it('includes agent role hint in the user prompt', async () => {
		mockTextComplete.mockResolvedValue('Progress update.');

		await callProgressModel('test-model', makeContext({ agentType: 'splitting' }), []);

		const userPrompt = mockTextComplete.mock.calls[0][0] as string;
		expect(userPrompt).toContain('Agent: splitting');
		expect(userPrompt).toContain(
			'Agent role: Breaks down a feature plan into smaller, ordered work items (subtasks)',
		);
	});

	it('uses fallback role hint for unknown agent types', async () => {
		mockTextComplete.mockResolvedValue('Progress update.');

		await callProgressModel('test-model', makeContext({ agentType: 'unknown-agent' }), []);

		const userPrompt = mockTextComplete.mock.calls[0][0] as string;
		expect(userPrompt).toContain('Agent: unknown-agent');
		expect(userPrompt).toContain('Agent role: Processes the request');
	});
});
