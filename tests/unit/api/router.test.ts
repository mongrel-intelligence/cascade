import { describe, expect, it, vi } from 'vitest';

// Mock all dependencies the routers pull in
vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	projects: {},
	credentials: {},
	agentConfigs: {},
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	listRuns: vi.fn(),
	getRunById: vi.fn(),
	getRunLogs: vi.fn(),
	listLlmCallsMeta: vi.fn(),
	getLlmCallByNumber: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
	deleteDebugAnalysisByRunId: vi.fn(),
	listProjectsForOrg: vi.fn(),
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectById: vi.fn(),
	loadConfig: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-status.js', () => ({
	isAnalysisRunning: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/db/repositories/settingsRepository.js', () => ({
	getOrganization: vi.fn(),
	updateOrganization: vi.fn(),
	listProjectsFull: vi.fn(),
	getProjectFull: vi.fn(),
	createProject: vi.fn(),
	updateProject: vi.fn(),
	deleteProject: vi.fn(),
	listProjectIntegrations: vi.fn(),
	upsertProjectIntegration: vi.fn(),
	deleteProjectIntegration: vi.fn(),
	getIntegrationByProjectAndCategory: vi.fn(),
	listIntegrationCredentials: vi.fn(),
	setIntegrationCredential: vi.fn(),
	removeIntegrationCredential: vi.fn(),
	listAgentConfigs: vi.fn(),
	createAgentConfig: vi.fn(),
	updateAgentConfig: vi.fn(),
	deleteAgentConfig: vi.fn(),
	listAllOrganizations: vi.fn(),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	listOrgCredentials: vi.fn(),
	createCredential: vi.fn(),
	updateCredential: vi.fn(),
	deleteCredential: vi.fn(),
	resolveAllIntegrationCredentials: vi.fn(),
	resolveAllOrgCredentials: vi.fn(),
	listProjectCredentials: vi.fn(),
	writeProjectCredential: vi.fn(),
	deleteProjectCredential: vi.fn(),
}));

vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('../../../src/db/crypto.js', () => ({
	decryptCredential: vi.fn((v: string) => v),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(),
	trelloClient: {
		getMe: vi.fn(),
		getBoards: vi.fn(),
		getBoardLists: vi.fn(),
		getBoardLabels: vi.fn(),
		getBoardCustomFields: vi.fn(),
	},
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(),
	jiraClient: {
		getMyself: vi.fn(),
		searchProjects: vi.fn(),
		getProjectStatuses: vi.fn(),
		getIssueTypesForProject: vi.fn(),
		getFields: vi.fn(),
	},
}));

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn(() => ({
		repos: {
			listWebhooks: vi.fn(),
			createWebhook: vi.fn(),
			deleteWebhook: vi.fn(),
		},
		users: {
			getAuthenticated: vi.fn(),
		},
	})),
}));

import { appRouter } from '../../../src/api/router.js';

describe('appRouter', () => {
	it('has auth sub-router with me procedure', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('auth.me');
	});

	it('has runs sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('runs.list');
		expect(procedures).toContain('runs.getById');
		expect(procedures).toContain('runs.getLogs');
		expect(procedures).toContain('runs.listLlmCalls');
		expect(procedures).toContain('runs.getLlmCall');
		expect(procedures).toContain('runs.getDebugAnalysis');
		expect(procedures).toContain('runs.getDebugAnalysisStatus');
		expect(procedures).toContain('runs.triggerDebugAnalysis');
	});

	it('has projects sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('projects.list');
		expect(procedures).toContain('projects.listFull');
		expect(procedures).toContain('projects.getById');
		expect(procedures).toContain('projects.create');
		expect(procedures).toContain('projects.update');
		expect(procedures).toContain('projects.delete');
		expect(procedures).toContain('projects.integrations.list');
		expect(procedures).toContain('projects.integrations.upsert');
		expect(procedures).toContain('projects.integrations.delete');
		expect(procedures).toContain('projects.integrationCredentials.list');
		expect(procedures).toContain('projects.integrationCredentials.set');
		expect(procedures).toContain('projects.integrationCredentials.remove');
	});

	it('has organization sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('organization.get');
		expect(procedures).toContain('organization.update');
		expect(procedures).toContain('organization.list');
	});

	it('has no top-level credentials sub-router (removed in favor of project-scoped credentials)', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).not.toContain('credentials.list');
		expect(procedures).not.toContain('credentials.create');
		expect(procedures).not.toContain('credentials.update');
		expect(procedures).not.toContain('credentials.delete');
	});

	it('has agentConfigs sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('agentConfigs.list');
		expect(procedures).toContain('agentConfigs.create');
		expect(procedures).toContain('agentConfigs.update');
		expect(procedures).toContain('agentConfigs.delete');
	});

	it('has webhooks sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('webhooks.list');
		expect(procedures).toContain('webhooks.create');
		expect(procedures).toContain('webhooks.delete');
	});

	it('has integrationsDiscovery sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('integrationsDiscovery.verifyTrello');
		expect(procedures).toContain('integrationsDiscovery.verifyJira');
		expect(procedures).toContain('integrationsDiscovery.trelloBoards');
		expect(procedures).toContain('integrationsDiscovery.trelloBoardDetails');
		expect(procedures).toContain('integrationsDiscovery.jiraProjects');
		expect(procedures).toContain('integrationsDiscovery.jiraProjectDetails');
		expect(procedures).toContain('integrationsDiscovery.verifyGithubToken');
	});
});
