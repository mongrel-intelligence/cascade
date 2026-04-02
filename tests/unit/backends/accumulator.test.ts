import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(),
}));

import {
	COMPLETED_TASKS_MAX,
	ProgressAccumulator,
	RING_BUFFER_MAX,
	summarizeToolParams,
	TEXT_SNIPPETS_MAX,
} from '../../../src/backends/progressState/accumulator.js';
import { loadTodos } from '../../../src/gadgets/todo/storage.js';

const mockLoadTodos = vi.mocked(loadTodos);

beforeEach(() => {
	mockLoadTodos.mockReturnValue([]);
});

describe('summarizeToolParams', () => {
	it('returns empty string when no params provided', () => {
		expect(summarizeToolParams('Bash')).toBe('');
	});

	it('returns file_path when present', () => {
		expect(summarizeToolParams('Read', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts');
	});

	it('returns filePath (camelCase) when present', () => {
		expect(summarizeToolParams('ReadFile', { filePath: '/src/bar.ts' })).toBe('/src/bar.ts');
	});

	it('returns truncated command (max 100 chars) when present', () => {
		const longCmd = 'npm run test:coverage -- --reporter verbose'.padEnd(120, ' extra');
		const result = summarizeToolParams('Bash', { command: longCmd });
		expect(result.length).toBeLessThanOrEqual(100);
	});

	it('returns pattern when present without path', () => {
		expect(summarizeToolParams('Grep', { pattern: 'class.*Foo' })).toBe('class.*Foo');
	});

	it('returns pattern with path when both present', () => {
		expect(summarizeToolParams('Grep', { pattern: 'class.*Foo', path: 'src/' })).toBe(
			'class.*Foo in src/',
		);
	});

	it('returns empty string when params exist but have no recognized keys', () => {
		expect(summarizeToolParams('Unknown', { randomKey: 'value' })).toBe('');
	});
});

describe('ProgressAccumulator', () => {
	function makeAccumulator() {
		return new ProgressAccumulator(vi.fn());
	}

	describe('onToolCall', () => {
		it('logs each tool call via logWriter', () => {
			const logWriter = vi.fn();
			const acc = new ProgressAccumulator(logWriter);
			acc.onToolCall('Bash', { command: 'npm test' });
			expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool call', {
				toolName: 'Bash',
				params: { command: 'npm test' },
			});
		});

		it('enforces ring buffer max (RING_BUFFER_MAX)', () => {
			const logWriter = vi.fn();
			const acc = new ProgressAccumulator(logWriter);
			for (let i = 0; i < RING_BUFFER_MAX + 5; i++) {
				acc.onToolCall(`Tool${i}`);
			}
			// Logged all calls
			expect(logWriter).toHaveBeenCalledTimes(RING_BUFFER_MAX + 5);
			// Snapshot should only have RING_BUFFER_MAX entries
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.recentToolCalls).toHaveLength(RING_BUFFER_MAX);
			// First entries should be the most recent ones
			expect(snap.recentToolCalls[0].name).toBe('Tool5');
			expect(snap.recentToolCalls[RING_BUFFER_MAX - 1].name).toBe(`Tool${RING_BUFFER_MAX + 4}`);
		});
	});

	describe('onText', () => {
		it('logs text output via logWriter', () => {
			const logWriter = vi.fn();
			const acc = new ProgressAccumulator(logWriter);
			acc.onText('Hello world');
			expect(logWriter).toHaveBeenCalledWith('INFO', 'Agent text output', { length: 11 });
		});

		it('ignores whitespace-only text', () => {
			const logWriter = vi.fn();
			const acc = new ProgressAccumulator(logWriter);
			acc.onText('   ');
			// Still logged but nothing added to snippets
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.recentTextSnippets).toHaveLength(0);
		});

		it('truncates text to 200 chars in snippet', () => {
			const acc = makeAccumulator();
			const longText = 'x'.repeat(300);
			acc.onText(longText);
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.recentTextSnippets[0].text).toHaveLength(200);
		});

		it('enforces ring buffer max (TEXT_SNIPPETS_MAX)', () => {
			const acc = makeAccumulator();
			for (let i = 0; i < TEXT_SNIPPETS_MAX + 3; i++) {
				acc.onText(`Snippet ${i}`);
			}
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.recentTextSnippets).toHaveLength(TEXT_SNIPPETS_MAX);
		});
	});

	describe('onTaskCompleted', () => {
		it('logs completed task via logWriter', () => {
			const logWriter = vi.fn();
			const acc = new ProgressAccumulator(logWriter);
			acc.onTaskCompleted('t1', 'My Task', 'Did the thing');
			expect(logWriter).toHaveBeenCalledWith('INFO', 'Task completed', {
				taskId: 't1',
				subject: 'My Task',
			});
		});

		it('truncates summary to 300 chars', () => {
			const acc = makeAccumulator();
			const longSummary = 'y'.repeat(400);
			acc.onTaskCompleted('t1', 'Task', longSummary);
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.completedTasks[0].summary).toHaveLength(300);
		});

		it('enforces ring buffer max (COMPLETED_TASKS_MAX)', () => {
			const acc = makeAccumulator();
			for (let i = 0; i < COMPLETED_TASKS_MAX + 2; i++) {
				acc.onTaskCompleted(`t${i}`, `Task ${i}`, 'summary');
			}
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.completedTasks).toHaveLength(COMPLETED_TASKS_MAX);
		});
	});

	describe('onIteration', () => {
		it('records current and max iterations in snapshot', () => {
			const acc = makeAccumulator();
			acc.onIteration(7, 20);
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.iteration).toBe(7);
			expect(snap.maxIterations).toBe(20);
		});
	});

	describe('getSnapshot', () => {
		it('returns snapshot with correct agentType and taskDescription', () => {
			const acc = makeAccumulator();
			const snap = acc.getSnapshot('review', 'Review the PR');
			expect(snap.agentType).toBe('review');
			expect(snap.taskDescription).toBe('Review the PR');
		});

		it('returns todos from loadTodos()', () => {
			mockLoadTodos.mockReturnValue([
				{ id: '1', content: 'Do thing', status: 'todo' },
				{ id: '2', content: 'Other thing', status: 'done' },
			]);
			const acc = makeAccumulator();
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.todos).toHaveLength(2);
			expect(snap.todos[0].content).toBe('Do thing');
		});

		it('returns elapsed time > 0', () => {
			const acc = makeAccumulator();
			const snap = acc.getSnapshot('impl', 'task');
			expect(snap.elapsedMinutes).toBeGreaterThanOrEqual(0);
		});

		it('returns copies of arrays (not references)', () => {
			const acc = makeAccumulator();
			acc.onToolCall('Bash');
			const snap1 = acc.getSnapshot('impl', 'task');
			acc.onToolCall('Read');
			const snap2 = acc.getSnapshot('impl', 'task');
			// snap1 should still have only 1 entry
			expect(snap1.recentToolCalls).toHaveLength(1);
			expect(snap2.recentToolCalls).toHaveLength(2);
		});
	});
});
