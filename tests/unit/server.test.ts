import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock heavy imports BEFORE importing server module
vi.mock('../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
}));

vi.mock('../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn(),
}));

vi.mock('../../src/utils/index.js', () => ({
	canAcceptWebhook: vi.fn().mockReturnValue(true),
	isCurrentlyProcessing: vi.fn().mockReturnValue(false),
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: vi.fn(),
}));

vi.mock('../../src/api/router.js', () => ({
	appRouter: {},
}));

vi.mock('@hono/trpc-server', () => ({
	trpcServer: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../../src/api/auth/login.js', () => ({
	loginHandler: vi.fn(),
}));
vi.mock('../../src/api/auth/logout.js', () => ({
	logoutHandler: vi.fn(),
}));
vi.mock('../../src/api/auth/session.js', () => ({
	resolveUserFromSession: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/api/context.js', () => ({
	computeEffectiveOrgId: vi.fn().mockResolvedValue('org-1'),
}));

import { findProjectByRepo } from '../../src/config/provider.js';
import { resolvePersonaIdentities } from '../../src/github/personas.js';
import { sendAcknowledgeReaction } from '../../src/router/reactions.js';
import { createServer } from '../../src/server.js';
import type { ServerDependencies } from '../../src/server.js';

const mockSendAcknowledgeReaction = vi.mocked(sendAcknowledgeReaction);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockResolvePersonaIdentities = vi.mocked(resolvePersonaIdentities);

function buildDeps(overrides: Partial<ServerDependencies> = {}): ServerDependencies {
	return {
		config: {
			defaults: {
				model: 'test-model',
				agentModels: {},
				maxIterations: 50,
				agentIterations: {},
				watchdogTimeoutMs: 30000,
				cardBudgetUsd: 5,
				agentBackend: 'llmist',
				progressModel: 'test-model',
				progressIntervalMinutes: 5,
				prompts: {},
			},
			projects: [
				{
					id: 'project-1',
					orgId: 'org-1',
					name: 'Test Project',
					repo: 'owner/repo',
					baseBranch: 'main',
					branchPrefix: 'feature/',
					pm: { type: 'trello' },
					trello: {
						boardId: 'board-123',
						lists: { briefing: 'l1', planning: 'l2', todo: 'l3' },
						labels: {},
					},
				},
			],
		},
		onTrelloWebhook: vi.fn().mockResolvedValue(undefined),
		onGitHubWebhook: vi.fn().mockResolvedValue(undefined),
		onJiraWebhook: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

async function postJson(
	app: ReturnType<typeof createServer>,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
	return app.fetch(request);
}

describe('createServer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Trello webhook', () => {
		it('calls sendAcknowledgeReaction for commentCard events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			const payload = {
				model: { id: 'board-123', name: 'Board' },
				action: {
					id: 'action-1',
					type: 'commentCard',
					data: { text: 'hello', card: { id: 'c1' } },
				},
			};

			const response = await postJson(app, '/trello/webhook', payload);
			expect(response.status).toBe(200);

			// Allow promises to resolve
			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'project-1', payload);
			vi.useRealTimers();
		});

		it('does not call sendAcknowledgeReaction for non-comment Trello events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			const payload = {
				model: { id: 'board-123', name: 'Board' },
				action: {
					id: 'action-1',
					type: 'updateCard',
					data: {},
				},
			};

			const response = await postJson(app, '/trello/webhook', payload);
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('does not call sendAcknowledgeReaction when board is not configured', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			const payload = {
				model: { id: 'unknown-board', name: 'Board' },
				action: {
					id: 'action-1',
					type: 'commentCard',
					data: { text: 'hello' },
				},
			};

			const response = await postJson(app, '/trello/webhook', payload);
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	describe('GitHub webhook', () => {
		it('calls sendAcknowledgeReaction for issue_comment events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			// Mock project resolution
			const mockProject = deps.config.projects[0];
			mockFindProjectByRepo.mockResolvedValue(mockProject);
			mockResolvePersonaIdentities.mockResolvedValue({
				implementer: 'bot-implementer',
				reviewer: 'bot-reviewer',
			});

			const payload = {
				action: 'created',
				issue: { number: 1 },
				comment: { id: 42, body: 'hello' },
				repository: { full_name: 'owner/repo' },
			};

			const response = await postJson(app, '/github/webhook', payload, {
				'X-GitHub-Event': 'issue_comment',
			});
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockFindProjectByRepo).toHaveBeenCalledWith('owner/repo');
			expect(mockResolvePersonaIdentities).toHaveBeenCalledWith('project-1');
			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
				'github',
				'owner/repo',
				payload,
				{ implementer: 'bot-implementer', reviewer: 'bot-reviewer' },
				mockProject,
			);
			vi.useRealTimers();
		});

		it('calls sendAcknowledgeReaction for pull_request_review_comment events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			// Mock project resolution
			const mockProject = deps.config.projects[0];
			mockFindProjectByRepo.mockResolvedValue(mockProject);
			mockResolvePersonaIdentities.mockResolvedValue({
				implementer: 'bot-implementer',
				reviewer: 'bot-reviewer',
			});

			const payload = {
				action: 'created',
				comment: { id: 99, body: 'review comment' },
				pull_request: { number: 5 },
				repository: { full_name: 'owner/repo' },
			};

			const response = await postJson(app, '/github/webhook', payload, {
				'X-GitHub-Event': 'pull_request_review_comment',
			});
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockFindProjectByRepo).toHaveBeenCalledWith('owner/repo');
			expect(mockResolvePersonaIdentities).toHaveBeenCalledWith('project-1');
			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
				'github',
				'owner/repo',
				payload,
				{ implementer: 'bot-implementer', reviewer: 'bot-reviewer' },
				mockProject,
			);
			vi.useRealTimers();
		});

		it('does not call sendAcknowledgeReaction for non-comment GitHub events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps();
			const app = createServer(deps);

			const payload = {
				action: 'completed',
				check_suite: { id: 1, conclusion: 'success' },
				repository: { full_name: 'owner/repo' },
			};

			const response = await postJson(app, '/github/webhook', payload, {
				'X-GitHub-Event': 'check_suite',
			});
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	describe('JIRA webhook', () => {
		it('calls sendAcknowledgeReaction for comment_created events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps({
				config: {
					defaults: buildDeps().config.defaults,
					projects: [
						{
							id: 'jira-project-1',
							orgId: 'org-1',
							name: 'JIRA Project',
							repo: 'owner/repo',
							baseBranch: 'main',
							branchPrefix: 'feature/',
							pm: { type: 'jira' },
							jira: {
								projectKey: 'PROJ',
								baseUrl: 'https://company.atlassian.net',
								statuses: {},
							},
						},
					],
				},
			});
			const app = createServer(deps);

			const payload = {
				webhookEvent: 'comment_created',
				issue: {
					id: '10001',
					key: 'PROJ-1',
					fields: { project: { key: 'PROJ' } },
				},
				comment: { id: '20001', body: { type: 'doc' } },
			};

			const response = await postJson(app, '/jira/webhook', payload);
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'jira-project-1', payload);
			vi.useRealTimers();
		});

		it('does not call sendAcknowledgeReaction for non-comment JIRA events', async () => {
			vi.useFakeTimers();
			const deps = buildDeps({
				config: {
					defaults: buildDeps().config.defaults,
					projects: [
						{
							id: 'jira-project-1',
							orgId: 'org-1',
							name: 'JIRA Project',
							repo: 'owner/repo',
							baseBranch: 'main',
							branchPrefix: 'feature/',
							pm: { type: 'jira' },
							jira: {
								projectKey: 'PROJ',
								baseUrl: 'https://company.atlassian.net',
								statuses: {},
							},
						},
					],
				},
			});
			const app = createServer(deps);

			const payload = {
				webhookEvent: 'jira:issue_updated',
				issue: {
					id: '10001',
					key: 'PROJ-1',
					fields: { project: { key: 'PROJ' } },
				},
			};

			const response = await postJson(app, '/jira/webhook', payload);
			expect(response.status).toBe(200);

			await vi.runAllTimersAsync();

			expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
			vi.useRealTimers();
		});
	});
});
