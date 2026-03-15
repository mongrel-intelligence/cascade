import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();
const mockFindProjectById = vi.fn();
const mockLoadProjectConfigByJiraProjectKey = vi.fn();

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
	findProjectById: (...args: unknown[]) => mockFindProjectById(...args),
	loadProjectConfigByJiraProjectKey: (...args: unknown[]) =>
		mockLoadProjectConfigByJiraProjectKey(...args),
}));

const mockWithJiraCredentials = vi.fn().mockImplementation((_creds, fn) => fn());
vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: (...args: unknown[]) => mockWithJiraCredentials(...args),
}));

const mockPostJiraAck = vi.fn();
const mockDeleteJiraAck = vi.fn();
const mockResolveJiraBotAccountId = vi.fn();
vi.mock('../../../../src/router/acknowledgments.js', () => ({
	postJiraAck: (...args: unknown[]) => mockPostJiraAck(...args),
	deleteJiraAck: (...args: unknown[]) => mockDeleteJiraAck(...args),
	resolveJiraBotAccountId: (...args: unknown[]) => mockResolveJiraBotAccountId(...args),
}));

const mockSendAcknowledgeReaction = vi.fn();
vi.mock('../../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: (...args: unknown[]) => mockSendAcknowledgeReaction(...args),
}));

const mockGetJiraConfig = vi.fn();
vi.mock('../../../../src/pm/config.js', () => ({
	getJiraConfig: (...args: unknown[]) => mockGetJiraConfig(...args),
}));

import { JiraIntegration } from '../../../../src/pm/jira/integration.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'Test JIRA Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'PROJ',
			baseUrl: 'https://example.atlassian.net',
			statuses: {},
			labels: {},
		},
		...overrides,
	} as ProjectConfig;
}

function makeJiraConfig(overrides: Record<string, unknown> = {}) {
	return {
		projectKey: 'PROJ',
		baseUrl: 'https://example.atlassian.net',
		statuses: {
			backlog: 'Backlog',
			inProgress: 'In Progress',
			inReview: 'In Review',
			done: 'Done',
			merged: 'Merged',
		},
		labels: {
			processing: 'cascade-processing',
			processed: 'cascade-processed',
			error: 'cascade-error',
			readyToProcess: 'cascade-ready',
			auto: 'cascade-auto',
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JiraIntegration', () => {
	let integration: JiraIntegration;

	beforeEach(() => {
		vi.clearAllMocks();
		integration = new JiraIntegration();
		mockGetJiraConfig.mockReturnValue(makeJiraConfig());
	});

	it('has type "jira"', () => {
		expect(integration.type).toBe('jira');
	});

	// =========================================================================
	// createProvider
	// =========================================================================
	describe('createProvider', () => {
		it('returns a JiraPMProvider instance when projectKey is present', () => {
			const project = makeProject();
			const provider = integration.createProvider(project);
			expect(provider).toBeDefined();
			expect(provider.type).toBe('jira');
		});

		it('throws when jira config has no projectKey', () => {
			mockGetJiraConfig.mockReturnValue({ baseUrl: 'https://example.atlassian.net' }); // no projectKey
			const project = makeProject();
			expect(() => integration.createProvider(project)).toThrow(
				'JIRA integration requires projectKey in config',
			);
		});

		it('throws when jira config is undefined', () => {
			mockGetJiraConfig.mockReturnValue(undefined);
			const project = makeProject();
			expect(() => integration.createProvider(project)).toThrow(
				'JIRA integration requires projectKey in config',
			);
		});
	});

	// =========================================================================
	// withCredentials
	// =========================================================================
	describe('withCredentials', () => {
		it('fetches email, apiToken, and baseUrl then calls withJiraCredentials', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('bot@example.com');
			mockGetIntegrationCredential.mockResolvedValueOnce('api-token-xxx');
			mockFindProjectById.mockResolvedValue(makeProject());

			const fn = vi.fn().mockResolvedValue('done');
			const result = await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith('proj-1', 'pm', 'email');
			expect(mockGetIntegrationCredential).toHaveBeenCalledWith('proj-1', 'pm', 'api_token');
			expect(mockWithJiraCredentials).toHaveBeenCalledWith(
				{
					email: 'bot@example.com',
					apiToken: 'api-token-xxx',
					baseUrl: 'https://example.atlassian.net',
				},
				fn,
			);
			expect(result).toBe('done');
		});

		it('uses empty string for baseUrl when project not found', async () => {
			mockGetIntegrationCredential.mockResolvedValue('value');
			mockFindProjectById.mockResolvedValue(null);

			const fn = vi.fn().mockResolvedValue(undefined);
			await integration.withCredentials('proj-1', fn);

			expect(mockWithJiraCredentials).toHaveBeenCalledWith(
				expect.objectContaining({ baseUrl: '' }),
				fn,
			);
		});
	});

	// =========================================================================
	// resolveLifecycleConfig
	// =========================================================================
	describe('resolveLifecycleConfig', () => {
		it('maps jira labels and statuses to lifecycle config', () => {
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.labels.processing).toBe('cascade-processing');
			expect(config.labels.processed).toBe('cascade-processed');
			expect(config.labels.error).toBe('cascade-error');
			expect(config.labels.readyToProcess).toBe('cascade-ready');
			expect(config.labels.auto).toBe('cascade-auto');
			expect(config.statuses.backlog).toBe('Backlog');
			expect(config.statuses.inProgress).toBe('In Progress');
			expect(config.statuses.done).toBe('Done');
		});

		it('uses defaults for labels when no jira config labels set', () => {
			mockGetJiraConfig.mockReturnValue({ projectKey: 'PROJ', baseUrl: 'https://x.atlassian.net' });
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			// defaults
			expect(config.labels.processing).toBe('cascade-processing');
			expect(config.labels.processed).toBe('cascade-processed');
			expect(config.labels.readyToProcess).toBe('cascade-ready');
		});

		it('has undefined statuses when jira config has no statuses', () => {
			mockGetJiraConfig.mockReturnValue({ projectKey: 'PROJ' });
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.statuses.backlog).toBeUndefined();
		});
	});

	// =========================================================================
	// parseWebhookPayload
	// =========================================================================
	describe('parseWebhookPayload', () => {
		it('returns null when payload is null', () => {
			expect(integration.parseWebhookPayload(null)).toBeNull();
		});

		it('returns null when payload is not an object', () => {
			expect(integration.parseWebhookPayload('string')).toBeNull();
		});

		it('returns null when webhookEvent is missing', () => {
			expect(integration.parseWebhookPayload({ issue: { key: 'PROJ-1' } })).toBeNull();
		});

		it('returns null when projectKey is missing', () => {
			const raw = {
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'PROJ-1', fields: { project: {} } }, // no key
			};
			expect(integration.parseWebhookPayload(raw)).toBeNull();
		});

		it('parses a typical jira:issue_updated payload', () => {
			const raw = {
				webhookEvent: 'jira:issue_updated',
				issue: {
					key: 'PROJ-123',
					fields: { project: { key: 'PROJ' } },
				},
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('jira:issue_updated');
			expect(result?.projectIdentifier).toBe('PROJ');
			expect(result?.workItemId).toBe('PROJ-123');
			expect(result?.raw).toBe(raw);
		});

		it('parses a comment_created event', () => {
			const raw = {
				webhookEvent: 'comment_created',
				issue: {
					key: 'PROJ-42',
					fields: { project: { key: 'PROJ' } },
				},
				comment: { author: { accountId: 'user-abc' } },
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result?.eventType).toBe('comment_created');
			expect(result?.workItemId).toBe('PROJ-42');
		});
	});

	// =========================================================================
	// isSelfAuthored
	// =========================================================================
	describe('isSelfAuthored', () => {
		it('returns false for non-comment events (not starting with comment_)', async () => {
			const event = {
				eventType: 'jira:issue_updated',
				projectIdentifier: 'PROJ',
				raw: {},
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
			expect(mockResolveJiraBotAccountId).not.toHaveBeenCalled();
		});

		it('returns true when comment author matches bot account ID', async () => {
			mockResolveJiraBotAccountId.mockResolvedValue('bot-account-id');
			const event = {
				eventType: 'comment_created',
				projectIdentifier: 'PROJ',
				raw: { comment: { author: { accountId: 'bot-account-id' } } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(true);
		});

		it('returns false when comment author does not match bot account ID', async () => {
			mockResolveJiraBotAccountId.mockResolvedValue('bot-account-id');
			const event = {
				eventType: 'comment_created',
				projectIdentifier: 'PROJ',
				raw: { comment: { author: { accountId: 'human-user' } } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});

		it('returns false when comment has no author accountId', async () => {
			const event = {
				eventType: 'comment_created',
				projectIdentifier: 'PROJ',
				raw: { comment: {} },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});

		it('returns false when resolveJiraBotAccountId throws', async () => {
			mockResolveJiraBotAccountId.mockRejectedValue(new Error('API error'));
			const event = {
				eventType: 'comment_created',
				projectIdentifier: 'PROJ',
				raw: { comment: { author: { accountId: 'some-id' } } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// postAckComment
	// =========================================================================
	describe('postAckComment', () => {
		it('delegates to postJiraAck and returns its result', async () => {
			mockPostJiraAck.mockResolvedValue('jira-comment-id');
			const result = await integration.postAckComment('proj-1', 'PROJ-1', 'Starting...');
			expect(mockPostJiraAck).toHaveBeenCalledWith('proj-1', 'PROJ-1', 'Starting...');
			expect(result).toBe('jira-comment-id');
		});
	});

	// =========================================================================
	// deleteAckComment
	// =========================================================================
	describe('deleteAckComment', () => {
		it('delegates to deleteJiraAck', async () => {
			mockDeleteJiraAck.mockResolvedValue(undefined);
			await integration.deleteAckComment('proj-1', 'PROJ-1', 'comment-id');
			expect(mockDeleteJiraAck).toHaveBeenCalledWith('proj-1', 'PROJ-1', 'comment-id');
		});
	});

	// =========================================================================
	// sendReaction
	// =========================================================================
	describe('sendReaction', () => {
		it('calls sendAcknowledgeReaction with jira provider and raw payload', async () => {
			const rawPayload = { webhookEvent: 'comment_created' };
			const event = {
				eventType: 'comment_created',
				projectIdentifier: 'PROJ',
				raw: rawPayload,
			};
			mockSendAcknowledgeReaction.mockResolvedValue(undefined);

			await integration.sendReaction('proj-1', event);

			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'proj-1', rawPayload);
		});
	});

	// =========================================================================
	// lookupProject
	// =========================================================================
	describe('lookupProject', () => {
		it('returns project config when found by JIRA project key', async () => {
			const mockResult = {
				project: makeProject(),
				config: { projects: [] },
			};
			mockLoadProjectConfigByJiraProjectKey.mockResolvedValue(mockResult);

			const result = await integration.lookupProject('PROJ');

			expect(mockLoadProjectConfigByJiraProjectKey).toHaveBeenCalledWith('PROJ');
			expect(result).toBe(mockResult);
		});

		it('returns null when no project found', async () => {
			mockLoadProjectConfigByJiraProjectKey.mockResolvedValue(null);
			const result = await integration.lookupProject('UNKNOWN');
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// extractWorkItemId
	// =========================================================================
	describe('extractWorkItemId', () => {
		it('extracts JIRA issue key from text', () => {
			expect(integration.extractWorkItemId('Working on PROJ-123 today')).toBe('PROJ-123');
		});

		it('extracts issue key from PR body', () => {
			expect(
				integration.extractWorkItemId(
					'Fixes ABC-42\n\nThis PR implements the feature described in ABC-42.',
				),
			).toBe('ABC-42');
		});

		it('returns null when no JIRA issue key found', () => {
			expect(integration.extractWorkItemId('No issue key here')).toBeNull();
		});

		it('returns null for lowercase issue references', () => {
			// Pattern requires uppercase project prefix
			expect(integration.extractWorkItemId('proj-123 is lowercase')).toBeNull();
		});

		it('matches multi-letter project keys', () => {
			expect(integration.extractWorkItemId('MYPROJECT-999')).toBe('MYPROJECT-999');
		});
	});
});
