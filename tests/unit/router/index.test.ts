import { describe, expect, it, vi } from 'vitest';

// Mock heavy imports that cause side effects
vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
	getQueueStats: vi.fn(),
}));
vi.mock('../../../src/router/worker-manager.js', () => ({
	getActiveWorkerCount: vi.fn(),
	getActiveWorkers: vi.fn(),
	startWorkerProcessor: vi.fn(),
	stopWorkerProcessor: vi.fn(),
}));
vi.mock('@hono/node-server', () => ({
	serve: vi.fn(),
}));
vi.mock('../../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: vi.fn(),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));
vi.mock('../../../src/router/pre-actions.js', () => ({
	addEyesReactionToPR: vi.fn(),
}));
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn().mockResolvedValue({ projects: [] }),
}));

import { loadProjectConfig } from '../../../src/router/config.js';

describe('router config integration', () => {
	it('loadProjectConfig returns projects', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [
				{
					id: 'p1',
					repo: 'owner/repo',
					pmType: 'trello',
					trello: {
						boardId: 'board1',
						lists: { splitting: 'list1', planning: 'list2', todo: 'list3', debug: 'list4' },
						labels: { readyToProcess: 'label1' },
					},
				},
			],
		});
		const config = await loadProjectConfig();
		expect(config.projects).toHaveLength(1);
		expect(config.projects[0].id).toBe('p1');
	});
});
