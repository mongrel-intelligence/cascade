import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentLabel } from '../../../src/config/agentMessages.js';
import {
	formatGitHubProgressComment,
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../../../src/config/statusUpdateConfig.js';

// Mock todo storage
vi.mock('../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(() => []),
	formatTodoList: vi.fn(() => '- [ ] Task 1\n- [x] Task 2'),
}));

import { formatTodoList, loadTodos } from '../../../src/gadgets/todo/storage.js';

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

	describe('formatGitHubProgressComment', () => {
		it('includes header message', () => {
			vi.mocked(loadTodos).mockReturnValue([]);
			vi.mocked(formatTodoList).mockReturnValue('- [ ] Task 1');

			const comment = formatGitHubProgressComment('🔍 Reviewing PR...', 'review');

			expect(comment).toContain('🔍 Reviewing PR...');
		});

		it('does not include progress bar or iteration counters', () => {
			vi.mocked(loadTodos).mockReturnValue([]);
			vi.mocked(formatTodoList).mockReturnValue('');

			const comment = formatGitHubProgressComment('Header', 'review');

			expect(comment).not.toMatch(/\[█/);
			expect(comment).not.toMatch(/iteration \d+/);
			expect(comment).not.toMatch(/\d+%/);
			expect(comment).not.toContain('**Progress:**');
		});

		it('includes formatted todo list', () => {
			vi.mocked(loadTodos).mockReturnValue([{ id: '1', content: 'Task 1', status: 'pending' }]);
			vi.mocked(formatTodoList).mockReturnValue('- [ ] Task 1\n- [x] Task 2');

			const comment = formatGitHubProgressComment('🔍 Reviewing PR...', 'review');

			expect(comment).toContain('- [ ] Task 1');
			expect(comment).toContain('- [x] Task 2');
		});

		it('includes metadata footer with agent type', () => {
			vi.mocked(loadTodos).mockReturnValue([]);
			vi.mocked(formatTodoList).mockReturnValue('');

			const comment = formatGitHubProgressComment('🚀 Implementing feature...', 'implementation');

			expect(comment).toContain('<sub>implementation</sub>');
		});

		it('separates sections with horizontal rule', () => {
			vi.mocked(loadTodos).mockReturnValue([]);
			vi.mocked(formatTodoList).mockReturnValue('');

			const comment = formatGitHubProgressComment('Header text', 'review');

			const lines = comment.split('\n');
			expect(lines).toContain('---');
		});

		it('preserves header message exactly as provided', () => {
			vi.mocked(loadTodos).mockReturnValue([]);
			vi.mocked(formatTodoList).mockReturnValue('');

			const headerWithMarkdown = '🔍 **Reviewing PR** #123\n\nThis is a test.';
			const comment = formatGitHubProgressComment(headerWithMarkdown, 'review');

			expect(comment.startsWith(headerWithMarkdown)).toBe(true);
		});

		it('loads todos and formats them via formatTodoList', () => {
			const todos = [
				{ id: '1', content: 'Test 1', status: 'done' as const },
				{ id: '2', content: 'Test 2', status: 'pending' as const },
			];
			vi.mocked(loadTodos).mockReturnValue(todos);
			vi.mocked(formatTodoList).mockReturnValue('formatted todos');

			const comment = formatGitHubProgressComment('Header', 'implementation');

			expect(loadTodos).toHaveBeenCalled();
			expect(formatTodoList).toHaveBeenCalledWith(todos);
			expect(comment).toContain('formatted todos');
		});
	});
});
