import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../src/types/index.js';

// Mock the adapters
vi.mock('../../../src/pm/trello/adapter.js', () => ({
	TrelloPMProvider: vi.fn().mockImplementation(() => ({
		type: 'trello',
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
	})),
}));

vi.mock('../../../src/pm/jira/adapter.js', () => ({
	JiraPMProvider: vi.fn().mockImplementation((config) => ({
		type: 'jira',
		config,
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
	})),
}));

// Mock provider.ts to avoid DB calls from integration constructors
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn().mockResolvedValue('mock-cred'),
	getIntegrationCredentialOrNull: vi.fn().mockResolvedValue(null),
	loadProjectConfigByBoardId: vi.fn().mockResolvedValue(null),
	loadProjectConfigByJiraProjectKey: vi.fn().mockResolvedValue(null),
	findProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((_creds, fn) => fn()),
	trelloClient: {},
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds, fn) => fn()),
	jiraClient: {},
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token, fn) => fn()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn().mockResolvedValue(null),
	deleteTrelloAck: vi.fn().mockResolvedValue(undefined),
	resolveTrelloBotMemberId: vi.fn().mockResolvedValue(null),
	postJiraAck: vi.fn().mockResolvedValue(null),
	deleteJiraAck: vi.fn().mockResolvedValue(undefined),
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

// Import bootstrap after mocks — registers integrations into pmRegistry via the canonical path
import '../../../src/integrations/bootstrap.js';

// Import after mocks so the integrations register with mocked adapters
// factory.ts was removed; createPMProvider is now an inline function in index.ts
import { createPMProvider } from '../../../src/pm/index.js';
import { JiraPMProvider } from '../../../src/pm/jira/adapter.js';
import { TrelloPMProvider } from '../../../src/pm/trello/adapter.js';

describe('pm/factory', () => {
	describe('createPMProvider', () => {
		it('returns TrelloPMProvider when pm.type is trello', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Trello Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'trello' },
				trello: {
					boardId: 'board123',
					labels: { processing: 'label-id' },
					lists: { todo: 'list-id' },
				},
			};

			const provider = createPMProvider(project);

			expect(TrelloPMProvider).toHaveBeenCalled();
			expect(provider.type).toBe('trello');
		});

		it('returns TrelloPMProvider when pm.type is undefined (defaults to trello)', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Default Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				trello: {
					boardId: 'board123',
					labels: { processing: 'label-id' },
					lists: { todo: 'list-id' },
				},
			};

			const provider = createPMProvider(project);

			expect(TrelloPMProvider).toHaveBeenCalled();
			expect(provider.type).toBe('trello');
		});

		it('returns JiraPMProvider when pm.type is jira', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'JIRA Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'jira' },
				jira: {
					projectKey: 'PROJ',
					statuses: {
						inProgress: 'In Progress',
						inReview: 'Code Review',
						done: 'Done',
						merged: 'Merged',
					},
				},
			};

			const provider = createPMProvider(project);

			expect(JiraPMProvider).toHaveBeenCalledWith(project.jira);
			expect(provider.type).toBe('jira');
		});

		it('throws error when pm.type is jira but jira config is missing', () => {
			const project: ProjectConfig = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Invalid JIRA Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'jira' },
				// No jira config
			};

			expect(() => createPMProvider(project)).toThrow(
				'JIRA integration requires projectKey in config',
			);
		});

		it('throws error for unknown pm.type', () => {
			const project = {
				id: 'proj1',
				orgId: 'org1',
				name: 'Unknown PM Project',
				repo: 'owner/repo',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				pm: { type: 'unknown' },
			} as ProjectConfig;

			expect(() => createPMProvider(project)).toThrow("Unknown PM integration type: 'unknown'");
		});
	});
});
