import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/runLink.js', () => ({
	getDashboardUrl: vi.fn(),
}));

// Mock everything that buildExecutionPlan might call
vi.mock('../../../src/agents/shared/modelResolution.js', () => ({
	resolveModelConfig: vi.fn().mockResolvedValue({
		systemPrompt: 'system',
		taskPrompt: 'task',
		model: 'claude',
		maxIterations: 10,
	}),
}));

vi.mock('../../../src/agents/shared/promptContext.js', () => ({
	buildPromptContext: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/db/repositories/partialsRepository.js', () => ({
	loadPartials: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

vi.mock('../../../src/agents/definitions/profiles.js', () => ({
	getAgentProfile: vi.fn().mockReturnValue({
		fetchContext: vi.fn().mockResolvedValue({}),
		finishHooks: {},
		filterTools: vi.fn().mockReturnValue([]),
	}),
}));

vi.mock('../../../src/agents/definitions/toolManifests.js', () => ({
	getToolManifests: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/backends/registry.js', () => ({
	isNativeToolEngineDefinition: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/agents/definitions/index.js', () => ({
	needsGitStateStopHooks: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/backends/secretBuilder.js', () => ({
	augmentProjectSecrets: vi.fn().mockResolvedValue({}),
	resolveGitHubToken: vi.fn(),
	injectGitHubAckCommentId: vi.fn(),
	injectProgressCommentId: vi.fn(),
}));

vi.mock('../../../src/backends/sidecarManager.js', () => ({
	createCompletionArtifacts: vi.fn().mockReturnValue({}),
}));

import { buildPromptContext } from '../../../src/agents/shared/promptContext.js';
import {
	buildExecutionPlan,
	injectRunLinkSecrets,
} from '../../../src/backends/secretOrchestrator.js';
import type { AgentEngine } from '../../../src/backends/types.js';
import { getSentryIntegrationConfig } from '../../../src/sentry/integration.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { getDashboardUrl } from '../../../src/utils/runLink.js';

const mockGetDashboardUrl = vi.mocked(getDashboardUrl);
const mockGetSentryIntegrationConfig = vi.mocked(getSentryIntegrationConfig);
const mockBuildPromptContext = vi.mocked(buildPromptContext);

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

function makeInput(
	project: ProjectConfig,
	triggerType: string,
): AgentInput & { project: ProjectConfig; config: CascadeConfig } {
	return {
		project,
		config: { projects: [] } as unknown as CascadeConfig,
		triggerType: triggerType as AgentInput['triggerType'],
	};
}

const noopLogWriter = () => {};
const noopAgentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

const engine: AgentEngine = {
	definition: {
		id: 'claude-code',
		label: 'Claude Code',
		description: 'Test engine',
		archetype: 'native-tool',
		capabilities: [],
		modelSelection: { type: 'free-text' },
		logLabel: 'Engine Log',
	},
	execute: vi.fn(),
	supportsAgentType: () => true,
};

beforeEach(() => {
	mockGetDashboardUrl.mockReturnValue(undefined);
	vi.clearAllMocks();
});

describe('buildExecutionPlan', () => {
	it('fetches sentry config for alerting agent', async () => {
		mockGetSentryIntegrationConfig.mockResolvedValueOnce({
			organizationSlug: 'org',
			resultsContainerId: 'sentry-container-123',
		});

		const project = makeProject();
		await buildExecutionPlan(
			'alerting',
			makeInput(project, 'sentry:issue-created'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			'token',
			false,
			'claude-code',
			engine,
		);

		expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('test-project');
		expect(mockBuildPromptContext).toHaveBeenCalledWith(
			undefined,
			project,
			'sentry:issue-created',
			undefined,
			undefined,
			'sentry-container-123',
		);
	});

	it('does not fetch sentry config for non-alerting agent', async () => {
		const project = makeProject();
		await buildExecutionPlan(
			'implementation',
			makeInput(project, 'manual'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			'token',
			false,
			'claude-code',
			engine,
		);

		expect(mockGetSentryIntegrationConfig).not.toHaveBeenCalled();
		expect(mockBuildPromptContext).toHaveBeenCalledWith(
			undefined,
			project,
			'manual',
			undefined,
			undefined,
			undefined,
		);
	});

	it('handles sentry config failure gracefully', async () => {
		mockGetSentryIntegrationConfig.mockRejectedValueOnce(new Error('DB failure'));

		const project = makeProject();
		await buildExecutionPlan(
			'alerting',
			makeInput(project, 'sentry:issue-created'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			'token',
			false,
			'claude-code',
			engine,
		);

		expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('test-project');
		expect(mockBuildPromptContext).toHaveBeenCalledWith(
			undefined,
			project,
			'sentry:issue-created',
			undefined,
			undefined,
			undefined,
		);
	});
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
