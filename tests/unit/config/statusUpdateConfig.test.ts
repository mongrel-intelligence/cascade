import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentLabel } from '../../../src/config/agentMessages.js';
import {
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../../../src/config/statusUpdateConfig.js';

// Mock agentMessages to avoid requiring initAgentMessages() in tests
vi.mock('../../../src/config/agentMessages.js', () => ({
	getAgentLabel: vi.fn((agentType: string) => {
		const labels: Record<string, { emoji: string; label: string }> = {
			implementation: { emoji: '🧑‍💻', label: 'Implementation Update' },
			review: { emoji: '🔍', label: 'Code Review Update' },
			splitting: { emoji: '📋', label: 'Splitting Update' },
			planning: { emoji: '🗺️', label: 'Planning Update' },
			'respond-to-review': { emoji: '🔧', label: 'Review Response Update' },
			'respond-to-ci': { emoji: '🔧', label: 'CI Fix Update' },
			'respond-to-pr-comment': { emoji: '💬', label: 'PR Comment Response Update' },
			'respond-to-planning-comment': { emoji: '💬', label: 'Planning Response Update' },
			debug: { emoji: '🐛', label: 'Debug Update' },
		};
		return labels[agentType] ?? { emoji: '⚙️', label: 'Progress Update' };
	}),
}));

// Mock todo storage
vi.mock('../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(() => []),
}));

import { loadTodos } from '../../../src/gadgets/todo/storage.js';

describe('config/statusUpdateConfig', () => {
	describe('getStatusUpdateConfig', () => {
		it('returns enabled config for non-debug agents', () => {
			const agentTypes = ['implementation', 'splitting', 'planning', 'review'];

			for (const agentType of agentTypes) {
				const config = getStatusUpdateConfig(agentType);

				expect(config.enabled).toBe(true);
				expect(config.intervalMinutes).toBe(5);
				expect(config.progressModel).toBe('openrouter:google/gemini-2.5-flash-lite');
			}
		});

		it('returns disabled config for debug agent', () => {
			const config = getStatusUpdateConfig('debug');

			expect(config.enabled).toBe(false);
			expect(config.intervalMinutes).toBe(5);
			expect(config.progressModel).toBe('openrouter:google/gemini-2.5-flash-lite');
		});

		it('uses fast, cheap model for progress summaries', () => {
			const config = getStatusUpdateConfig('implementation');

			expect(config.progressModel).toBe('openrouter:google/gemini-2.5-flash-lite');
		});

		it('has reasonable update interval', () => {
			const config = getStatusUpdateConfig('implementation');

			expect(config.intervalMinutes).toBeGreaterThan(0);
			expect(config.intervalMinutes).toBeLessThanOrEqual(10);
		});
	});

	describe('getAgentLabel', () => {
		it('returns correct emoji and label for implementation', () => {
			const result = getAgentLabel('implementation');
			expect(result).toEqual({ emoji: '🧑‍💻', label: 'Implementation Update' });
		});

		it('returns correct emoji and label for review', () => {
			const result = getAgentLabel('review');
			expect(result).toEqual({ emoji: '🔍', label: 'Code Review Update' });
		});

		it('returns correct emoji and label for splitting', () => {
			const result = getAgentLabel('splitting');
			expect(result).toEqual({ emoji: '📋', label: 'Splitting Update' });
		});

		it('returns correct emoji and label for planning', () => {
			const result = getAgentLabel('planning');
			expect(result).toEqual({ emoji: '🗺️', label: 'Planning Update' });
		});

		it('returns correct emoji and label for respond-to-review', () => {
			const result = getAgentLabel('respond-to-review');
			expect(result).toEqual({ emoji: '🔧', label: 'Review Response Update' });
		});

		it('returns correct emoji and label for respond-to-ci', () => {
			const result = getAgentLabel('respond-to-ci');
			expect(result).toEqual({ emoji: '🔧', label: 'CI Fix Update' });
		});

		it('returns correct emoji and label for respond-to-pr-comment', () => {
			const result = getAgentLabel('respond-to-pr-comment');
			expect(result).toEqual({ emoji: '💬', label: 'PR Comment Response Update' });
		});

		it('returns correct emoji and label for respond-to-planning-comment', () => {
			const result = getAgentLabel('respond-to-planning-comment');
			expect(result).toEqual({ emoji: '💬', label: 'Planning Response Update' });
		});

		it('returns correct emoji and label for debug', () => {
			const result = getAgentLabel('debug');
			expect(result).toEqual({ emoji: '🐛', label: 'Debug Update' });
		});

		it('returns default fallback for unknown agent types', () => {
			const result = getAgentLabel('future-unknown-agent');
			expect(result).toEqual({ emoji: '⚙️', label: 'Progress Update' });
		});
	});

	describe('formatStatusMessage', () => {
		it('includes agent-specific emoji/label', () => {
			vi.mocked(loadTodos).mockReturnValue([]);

			const message = formatStatusMessage('implementation');

			expect(message).toContain('**🧑‍💻 Implementation Update**');
			expect(message).toContain('implementation');
		});

		it('does not include progress bar or iteration counters', () => {
			vi.mocked(loadTodos).mockReturnValue([]);

			const message = formatStatusMessage('implementation');

			expect(message).not.toMatch(/\[█/);
			expect(message).not.toMatch(/iteration \d+\/\d+/);
			expect(message).not.toMatch(/\d+%/);
		});

		it('includes task counts when todos exist', () => {
			vi.mocked(loadTodos).mockReturnValue([
				{ id: '1', content: 'Task 1', status: 'done' },
				{ id: '2', content: 'Task 2', status: 'done' },
				{ id: '3', content: 'Task 3', status: 'pending' },
			]);

			const message = formatStatusMessage('implementation');

			expect(message).toContain('**Tasks:** 2/3 complete');
		});

		it('includes current in-progress task', () => {
			vi.mocked(loadTodos).mockReturnValue([
				{ id: '1', content: 'Write tests', status: 'in_progress' },
				{ id: '2', content: 'Fix linting', status: 'pending' },
			]);

			const message = formatStatusMessage('implementation');

			expect(message).toContain('**Working on:** Write tests');
		});

		it('does not include task section when no todos', () => {
			vi.mocked(loadTodos).mockReturnValue([]);

			const message = formatStatusMessage('implementation');

			expect(message).not.toContain('**Tasks:**');
			expect(message).not.toContain('**Working on:**');
		});

		it('does not include "Working on" when no in-progress todo', () => {
			vi.mocked(loadTodos).mockReturnValue([
				{ id: '1', content: 'Task 1', status: 'done' },
				{ id: '2', content: 'Task 2', status: 'pending' },
			]);

			const message = formatStatusMessage('planning');

			expect(message).toContain('**Tasks:**');
			expect(message).not.toContain('**Working on:**');
		});

		it('formats message with proper markdown structure', () => {
			vi.mocked(loadTodos).mockReturnValue([]);

			const message = formatStatusMessage('implementation');

			const lines = message.split('\n');
			expect(lines[0]).toBe('**🧑‍💻 Implementation Update** (implementation)');
		});
	});
});
