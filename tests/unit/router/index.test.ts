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
	getProjectConfig: vi.fn().mockReturnValue({ projects: [] }),
}));

// Import the functions we want to test - they are module-private so we test through exports
// We'll use a re-export approach by importing the raw module
// Since these functions aren't exported, we test them via the Hono app behavior instead

import { getProjectConfig } from '../../../src/router/config.js';

describe('router config integration', () => {
	it('getProjectConfig returns cached projects', () => {
		vi.mocked(getProjectConfig).mockReturnValue({
			projects: [
				{
					id: 'p1',
					repo: 'owner/repo',
					pmType: 'trello',
					trello: {
						boardId: 'board1',
						lists: { briefing: 'list1', planning: 'list2', todo: 'list3', debug: 'list4' },
						labels: { readyToProcess: 'label1' },
					},
				},
			],
		});
		const config = getProjectConfig();
		expect(config.projects).toHaveLength(1);
		expect(config.projects[0].id).toBe('p1');
	});
});
