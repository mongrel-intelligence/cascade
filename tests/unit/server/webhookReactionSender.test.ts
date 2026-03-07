import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockFindProjectByRepo,
	mockResolvePersonaIdentities,
	mockSendAcknowledgeReaction,
	mockLogger,
} = vi.hoisted(() => ({
	mockFindProjectByRepo: vi.fn(),
	mockResolvePersonaIdentities: vi.fn(),
	mockSendAcknowledgeReaction: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: mockFindProjectByRepo,
}));

vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: mockResolvePersonaIdentities,
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: mockSendAcknowledgeReaction,
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: mockLogger,
}));

import { buildReactionSender } from '../../../src/server/webhookReactionSender.js';
import type { CascadeConfig } from '../../../src/types/index.js';

function makeConfig(projectOverrides: Record<string, unknown> = {}): CascadeConfig {
	return {
		projects: [
			{
				id: 'project-1',
				name: 'Test Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				trello: { boardId: 'board-123', lists: {}, labels: {} },
				jira: { projectKey: 'PROJ' },
				...projectOverrides,
			},
		],
	} as unknown as CascadeConfig;
}

function makeTrelloPayload(boardId = 'board-123') {
	return {
		model: { id: boardId },
		action: { type: 'commentCard', data: {} },
	};
}

function makeGitHubPayload(repoFullName = 'owner/repo') {
	return {
		repository: { full_name: repoFullName },
		action: 'created',
	};
}

function makeJiraPayload(projectKey = 'PROJ') {
	return {
		webhookEvent: 'comment_created',
		issue: {
			key: `${projectKey}-1`,
			fields: {
				project: { key: projectKey },
			},
		},
	};
}

describe('buildReactionSender - trello', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockSendAcknowledgeReaction.mockResolvedValue(undefined);
	});

	it('throws when config is not provided for trello', () => {
		expect(() => buildReactionSender('trello')).toThrow(
			'buildReactionSender: config required for trello',
		);
	});

	it('reacts on commentCard events', async () => {
		const sender = buildReactionSender('trello', makeConfig());

		sender(makeTrelloPayload(), 'commentCard');

		// Allow microtasks to run
		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
			'trello',
			'project-1',
			expect.objectContaining({ model: { id: 'board-123' } }),
		);
	});

	it('does not react on non-commentCard events', async () => {
		const sender = buildReactionSender('trello', makeConfig());

		sender(makeTrelloPayload(), 'updateCard');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('does not react when no project found for boardId', async () => {
		const config = makeConfig({ trello: { boardId: 'different-board', lists: {}, labels: {} } });
		const sender = buildReactionSender('trello', config);

		sender(makeTrelloPayload('no-match-board'), 'commentCard');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});
});

describe('buildReactionSender - github', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockSendAcknowledgeReaction.mockResolvedValue(undefined);
		mockFindProjectByRepo.mockResolvedValue({
			id: 'project-1',
			name: 'Test Project',
		});
		mockResolvePersonaIdentities.mockResolvedValue({
			implementer: 'impl-bot',
			reviewer: 'review-bot',
		});
	});

	it('does not require config', () => {
		expect(() => buildReactionSender('github')).not.toThrow();
	});

	it('reacts on issue_comment events', async () => {
		const sender = buildReactionSender('github');

		sender(makeGitHubPayload(), 'issue_comment');

		await new Promise((r) => setTimeout(r, 50));

		expect(mockFindProjectByRepo).toHaveBeenCalledWith('owner/repo');
		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
			'github',
			'owner/repo',
			expect.any(Object),
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('reacts on pull_request_review_comment events', async () => {
		const sender = buildReactionSender('github');

		sender(makeGitHubPayload(), 'pull_request_review_comment');

		await new Promise((r) => setTimeout(r, 50));

		expect(mockSendAcknowledgeReaction).toHaveBeenCalled();
	});

	it('does not react on other event types', async () => {
		const sender = buildReactionSender('github');

		sender(makeGitHubPayload(), 'push');

		await new Promise((r) => setTimeout(r, 50));

		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('logs warning when no project found for repo', async () => {
		mockFindProjectByRepo.mockResolvedValue(null);
		const sender = buildReactionSender('github');

		sender(makeGitHubPayload(), 'issue_comment');

		await new Promise((r) => setTimeout(r, 50));

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('No project found for repo'),
			expect.any(Object),
		);
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('logs error when reaction fails', async () => {
		mockFindProjectByRepo.mockResolvedValue({ id: 'p1', name: 'P1' });
		mockSendAcknowledgeReaction.mockRejectedValue(new Error('Network error'));
		const sender = buildReactionSender('github');

		sender(makeGitHubPayload(), 'issue_comment');

		await new Promise((r) => setTimeout(r, 50));

		expect(mockLogger.error).toHaveBeenCalledWith(
			'[Server] GitHub reaction error:',
			expect.any(Object),
		);
	});
});

describe('buildReactionSender - jira', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockSendAcknowledgeReaction.mockResolvedValue(undefined);
	});

	it('throws when config is not provided for jira', () => {
		expect(() => buildReactionSender('jira')).toThrow(
			'buildReactionSender: config required for jira',
		);
	});

	it('reacts on comment_created events', async () => {
		const sender = buildReactionSender('jira', makeConfig());

		sender(makeJiraPayload(), 'comment_created');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
			'jira',
			'project-1',
			expect.any(Object),
		);
	});

	it('reacts on comment_updated events', async () => {
		const sender = buildReactionSender('jira', makeConfig());

		sender(makeJiraPayload(), 'comment_updated');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).toHaveBeenCalled();
	});

	it('does not react on non-comment events', async () => {
		const sender = buildReactionSender('jira', makeConfig());

		sender(makeJiraPayload(), 'jira:issue_updated');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('does not react when no project found for JIRA key', async () => {
		const sender = buildReactionSender('jira', makeConfig({ jira: { projectKey: 'OTHER' } }));

		sender(makeJiraPayload('PROJ'), 'comment_created');

		await new Promise((r) => setTimeout(r, 10));

		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});
});

describe('buildReactionSender - unknown source', () => {
	it('returns a no-op function for unknown sources', () => {
		const sender = buildReactionSender('slack');
		expect(() => sender({}, 'some_event')).not.toThrow();
	});
});
