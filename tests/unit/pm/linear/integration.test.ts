import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();
const mockGetIntegrationCredentialOrNull = vi.fn();
const mockLoadProjectConfigByLinearTeamId = vi.fn();

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
	getIntegrationCredentialOrNull: (...args: unknown[]) =>
		mockGetIntegrationCredentialOrNull(...args),
	loadProjectConfigByLinearTeamId: (...args: unknown[]) =>
		mockLoadProjectConfigByLinearTeamId(...args),
}));

const mockGetIntegrationProvider = vi.fn();
vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: (...args: unknown[]) => mockGetIntegrationProvider(...args),
}));

const mockWithLinearCredentials = vi.fn().mockImplementation((_creds, fn) => fn());
vi.mock('../../../../src/linear/client.js', () => ({
	withLinearCredentials: (...args: unknown[]) => mockWithLinearCredentials(...args),
	linearClient: {
		getMe: vi.fn().mockResolvedValue({ id: 'user-bot', name: 'Bot', email: 'bot@example.com' }),
		createComment: vi.fn().mockResolvedValue({ id: 'comment-id', body: 'msg' }),
		deleteComment: vi.fn().mockResolvedValue(undefined),
	},
}));

const mockGetLinearConfig = vi.fn();
vi.mock('../../../../src/pm/config.js', () => ({
	getLinearConfig: (...args: unknown[]) => mockGetLinearConfig(...args),
}));

// Must mock registerCredentialRoles to avoid side effects in tests
vi.mock('../../../../src/config/integrationRoles.js', () => ({
	PROVIDER_CREDENTIAL_ROLES: new Proxy(
		{},
		{
			get(_target, prop: string) {
				if (prop === 'linear') {
					return [
						{ role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
						{
							role: 'webhook_secret',
							label: 'Webhook Secret',
							envVarKey: 'LINEAR_WEBHOOK_SECRET',
							optional: true,
						},
					];
				}
				return [];
			},
		},
	),
	registerCredentialRoles: vi.fn(),
}));

import { LinearIntegration } from '../../../../src/pm/linear/integration.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'Test Linear Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'linear' },
		...overrides,
	} as ProjectConfig;
}

function makeLinearConfig(overrides: Record<string, unknown> = {}) {
	return {
		teamId: 'team-abc',
		statuses: {
			backlog: 'state-backlog',
			inProgress: 'state-in-progress',
			inReview: 'state-in-review',
			done: 'state-done',
			merged: 'state-merged',
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

describe('LinearIntegration', () => {
	let integration: LinearIntegration;

	beforeEach(() => {
		integration = new LinearIntegration();
		mockGetLinearConfig.mockReturnValue(makeLinearConfig());
		vi.clearAllMocks();
		mockGetLinearConfig.mockReturnValue(makeLinearConfig());
		mockWithLinearCredentials.mockImplementation((_creds, fn) => fn());
	});

	it('has type "linear"', () => {
		expect(integration.type).toBe('linear');
	});

	it('has category "pm"', () => {
		expect(integration.category).toBe('pm');
	});

	// =========================================================================
	// hasIntegration
	// =========================================================================
	describe('hasIntegration', () => {
		it('returns false when PM provider is not linear', async () => {
			mockGetIntegrationProvider.mockResolvedValue(null);

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
			expect(mockGetIntegrationCredentialOrNull).not.toHaveBeenCalled();
		});

		it('returns false when PM provider is trello (not linear)', async () => {
			mockGetIntegrationProvider.mockResolvedValue('trello');

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('returns true when provider is linear and required credentials are present', async () => {
			mockGetIntegrationProvider.mockResolvedValue('linear');
			// LINEAR_API_KEY is required; LINEAR_WEBHOOK_SECRET is optional
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('lin_api_key_xxx');

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(true);
		});

		it('returns false when api_key is missing', async () => {
			mockGetIntegrationProvider.mockResolvedValue('linear');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce(null);

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// createProvider
	// =========================================================================
	describe('createProvider', () => {
		it('returns a LinearPMProvider instance when teamId is present', () => {
			const project = makeProject();
			const provider = integration.createProvider(project);
			expect(provider).toBeDefined();
			expect(provider.type).toBe('linear');
		});

		it('throws when linear config has no teamId', () => {
			mockGetLinearConfig.mockReturnValue({ statuses: {} }); // no teamId
			const project = makeProject();
			expect(() => integration.createProvider(project)).toThrow(
				'Linear integration requires teamId in config',
			);
		});

		it('throws when linear config is undefined', () => {
			mockGetLinearConfig.mockReturnValue(undefined);
			const project = makeProject();
			expect(() => integration.createProvider(project)).toThrow(
				'Linear integration requires teamId in config',
			);
		});
	});

	// =========================================================================
	// withCredentials
	// =========================================================================
	describe('withCredentials', () => {
		it('fetches api_key and calls withLinearCredentials', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('lin_api_key_xxx');

			const fn = vi.fn().mockResolvedValue('done');
			const result = await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith(
				'proj-1',
				'pm',
				'linear',
				'api_key',
			);
			expect(mockWithLinearCredentials).toHaveBeenCalledWith({ apiKey: 'lin_api_key_xxx' }, fn);
			expect(result).toBe('done');
		});
	});

	// =========================================================================
	// resolveLifecycleConfig
	// =========================================================================
	describe('resolveLifecycleConfig', () => {
		it('maps linear labels and statuses to lifecycle config', () => {
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.labels.processing).toBe('cascade-processing');
			expect(config.labels.processed).toBe('cascade-processed');
			expect(config.labels.error).toBe('cascade-error');
			expect(config.labels.readyToProcess).toBe('cascade-ready');
			expect(config.labels.auto).toBe('cascade-auto');
			expect(config.statuses.backlog).toBe('state-backlog');
			expect(config.statuses.inProgress).toBe('state-in-progress');
			expect(config.statuses.done).toBe('state-done');
		});

		it('preserves custom workflow status mappings for lifecycle moves', () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: 'team-abc',
				statuses: {
					prd: 'state-prd',
					story: 'state-story',
					'phased-plan': 'state-phased-plan',
				},
			});
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.statuses.prd).toBe('state-prd');
			expect(config.statuses.story).toBe('state-story');
			expect(config.statuses['phased-plan']).toBe('state-phased-plan');
		});

		it('returns undefined labels when labels config is missing (not name-string defaults)', () => {
			// Linear requires UUIDs for addLabel — name-string defaults like 'cascade-processing'
			// would cause resolveLabelId() to silently return null. When no label is configured,
			// undefined is the correct signal to skip the operation entirely.
			mockGetLinearConfig.mockReturnValue({ teamId: 'team-abc', statuses: {} });
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.labels.processing).toBeUndefined();
			expect(config.labels.processed).toBeUndefined();
			expect(config.labels.readyToProcess).toBeUndefined();
			expect(config.labels.error).toBeUndefined();
			expect(config.labels.auto).toBeUndefined();
		});

		it('has undefined statuses when linear config has no statuses', () => {
			mockGetLinearConfig.mockReturnValue({ teamId: 'team-abc', statuses: {} });
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

		it('returns null when action or type is missing', () => {
			expect(integration.parseWebhookPayload({ action: 'create' })).toBeNull();
			expect(integration.parseWebhookPayload({ type: 'Issue' })).toBeNull();
		});

		it('returns null when data is missing', () => {
			const raw = { action: 'create', type: 'Issue' };
			expect(integration.parseWebhookPayload(raw)).toBeNull();
		});

		it('returns null when projectIdentifier is missing', () => {
			const raw = {
				action: 'create',
				type: 'Issue',
				data: { identifier: 'TEAM-1' }, // no teamId
			};
			expect(integration.parseWebhookPayload(raw)).toBeNull();
		});

		it('parses an Issue.create payload', () => {
			const raw = {
				action: 'create',
				type: 'Issue',
				organizationId: 'org-123',
				data: {
					id: 'issue-uuid',
					identifier: 'TEAM-123',
					teamId: 'team-abc',
				},
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('Issue.create');
			expect(result?.projectIdentifier).toBe('team-abc');
			expect(result?.workItemId).toBe('TEAM-123');
			expect(result?.raw).toBe(raw);
		});

		it('parses an Issue.update payload', () => {
			const raw = {
				action: 'update',
				type: 'Issue',
				data: {
					id: 'issue-uuid',
					identifier: 'ENG-456',
					teamId: 'team-xyz',
				},
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result?.eventType).toBe('Issue.update');
			expect(result?.projectIdentifier).toBe('team-xyz');
			expect(result?.workItemId).toBe('ENG-456');
		});

		it('parses a Comment.create payload', () => {
			const raw = {
				action: 'create',
				type: 'Comment',
				data: {
					id: 'comment-uuid',
					body: 'Hello',
					userId: 'user-123',
					issue: {
						id: 'issue-uuid',
						identifier: 'TEAM-7',
						teamId: 'team-abc',
					},
				},
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result?.eventType).toBe('Comment.create');
			expect(result?.projectIdentifier).toBe('team-abc');
			expect(result?.workItemId).toBe('TEAM-7');
		});
	});

	// =========================================================================
	// isSelfAuthored
	// =========================================================================
	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const event = {
				eventType: 'Issue.update',
				projectIdentifier: 'team-abc',
				raw: {},
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});

		it('returns false when comment has no userId', async () => {
			const event = {
				eventType: 'Comment.create',
				projectIdentifier: 'team-abc',
				raw: { data: {} },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// lookupProject
	// =========================================================================
	describe('lookupProject', () => {
		it('returns the project+config when a matching Linear teamId is found', async () => {
			const project = makeProject();
			const config = { version: 1, agents: [] };
			mockLoadProjectConfigByLinearTeamId.mockResolvedValueOnce({ project, config });

			const result = await integration.lookupProject('team-abc');

			expect(mockLoadProjectConfigByLinearTeamId).toHaveBeenCalledWith('team-abc');
			expect(result).toEqual({ project, config });
		});

		it('returns null when no project matches the given teamId', async () => {
			mockLoadProjectConfigByLinearTeamId.mockResolvedValueOnce(undefined);

			const result = await integration.lookupProject('unknown-team');

			expect(mockLoadProjectConfigByLinearTeamId).toHaveBeenCalledWith('unknown-team');
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// extractWorkItemId
	// =========================================================================
	describe('extractWorkItemId', () => {
		it('extracts Linear issue identifier from text', () => {
			expect(integration.extractWorkItemId('Working on TEAM-123 today')).toBe('TEAM-123');
		});

		it('extracts issue identifier from Linear URL', () => {
			expect(
				integration.extractWorkItemId('See https://linear.app/myorg/issue/ENG-42 for details'),
			).toBe('ENG-42');
		});

		it('extracts from PR body with Linear URL', () => {
			expect(
				integration.extractWorkItemId(
					'Fixes https://linear.app/acme/issue/ACME-999\n\nImplementation details...',
				),
			).toBe('ACME-999');
		});

		it('extracts using text pattern when no URL', () => {
			expect(integration.extractWorkItemId('Refs ABC-42')).toBe('ABC-42');
		});

		it('returns null when no identifier found', () => {
			expect(integration.extractWorkItemId('No issue reference here')).toBeNull();
		});

		it('returns null for lowercase issue references', () => {
			expect(integration.extractWorkItemId('team-123 is lowercase')).toBeNull();
		});

		it('matches multi-letter team keys', () => {
			expect(integration.extractWorkItemId('MYTEAM-999')).toBe('MYTEAM-999');
		});

		it('prefers URL match over text match', () => {
			expect(
				integration.extractWorkItemId('URL: https://linear.app/org/issue/FRONT-10 text: BACK-20'),
			).toBe('FRONT-10');
		});
	});
});
