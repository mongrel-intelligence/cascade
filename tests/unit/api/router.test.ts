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
	getCascadeDefaults: vi.fn(),
	upsertCascadeDefaults: vi.fn(),
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
}));

vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn(() => ({
		repos: {
			listWebhooks: vi.fn(),
			createWebhook: vi.fn(),
			deleteWebhook: vi.fn(),
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

	it('has defaults sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('defaults.get');
		expect(procedures).toContain('defaults.upsert');
	});

	it('has credentials sub-router with all procedures', () => {
		const procedures = Object.keys(appRouter._def.procedures);
		expect(procedures).toContain('credentials.list');
		expect(procedures).toContain('credentials.create');
		expect(procedures).toContain('credentials.update');
		expect(procedures).toContain('credentials.delete');
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
});
