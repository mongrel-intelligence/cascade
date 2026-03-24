import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/runLink.js', () => ({
	getDashboardUrl: vi.fn(),
}));

import { injectRunLinkSecrets } from '../../../src/backends/secretOrchestrator.js';
import type { ProjectConfig } from '../../../src/types/index.js';
import { getDashboardUrl } from '../../../src/utils/runLink.js';

const mockGetDashboardUrl = vi.mocked(getDashboardUrl);

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test-project',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		...overrides,
	};
}

beforeEach(() => {
	mockGetDashboardUrl.mockReturnValue(undefined);
});

describe('injectRunLinkSecrets', () => {
	it('does nothing when runLinksEnabled is false', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: false });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets).toBeUndefined();
	});

	it('does nothing when dashboardUrl is absent', () => {
		mockGetDashboardUrl.mockReturnValue(undefined);
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets).toBeUndefined();
	});

	it('injects all run link secrets when enabled', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true, id: 'my-project' });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'claude-3-sonnet',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card-abc', 'run-uuid-123');

		expect(partialInput.projectSecrets).toEqual(
			expect.objectContaining({
				CASCADE_RUN_LINKS_ENABLED: 'true',
				CASCADE_DASHBOARD_URL: 'https://dashboard.example.com',
				CASCADE_ENGINE_LABEL: 'claude-code',
				CASCADE_MODEL: 'claude-3-sonnet',
				CASCADE_PROJECT_ID: 'my-project',
				CASCADE_WORK_ITEM_ID: 'card-abc',
				CASCADE_RUN_ID: 'run-uuid-123',
			}),
		);
	});

	it('skips CASCADE_WORK_ITEM_ID when workItemId is undefined', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', undefined, 'run-id-1');

		expect(partialInput.projectSecrets?.CASCADE_WORK_ITEM_ID).toBeUndefined();
	});

	it('skips CASCADE_RUN_ID when runId is undefined', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', undefined);

		expect(partialInput.projectSecrets?.CASCADE_RUN_ID).toBeUndefined();
	});

	it('initializes projectSecrets when undefined', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};
		expect(partialInput.projectSecrets).toBeUndefined();

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets).toBeDefined();
	});

	it('merges into existing projectSecrets', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
			projectSecrets: { EXISTING_KEY: 'existing-value' },
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets?.EXISTING_KEY).toBe('existing-value');
		expect(partialInput.projectSecrets?.CASCADE_RUN_LINKS_ENABLED).toBe('true');
	});

	it('uses empty string for model when model is undefined', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets?.CASCADE_MODEL).toBe('');
	});
});
