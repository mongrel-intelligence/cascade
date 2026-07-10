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
		capabilities: { required: ['fs:read'], optional: [] },
	}),
}));

vi.mock('../../../src/agents/capabilities/resolver.js', () => ({
	createIntegrationChecker: vi.fn().mockResolvedValue(() => true),
	resolveEffectiveCapabilities: vi.fn((required, optional) => [...required, ...optional]),
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

import {
	createIntegrationChecker,
	resolveEffectiveCapabilities,
} from '../../../src/agents/capabilities/resolver.js';
import { getAgentProfile } from '../../../src/agents/definitions/profiles.js';
import { resolveModelConfig } from '../../../src/agents/shared/modelResolution.js';
import { buildPromptContext } from '../../../src/agents/shared/promptContext.js';
import {
	buildExecutionPlan,
	injectRunLinkSecrets,
} from '../../../src/backends/secretOrchestrator.js';
import type { AgentEngine } from '../../../src/backends/types.js';
import type { UpdateChannel } from '../../../src/config/updateChannel.js';
import { getSentryIntegrationConfig } from '../../../src/sentry/integration.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { getDashboardUrl } from '../../../src/utils/runLink.js';

const mockGetDashboardUrl = vi.mocked(getDashboardUrl);
const mockGetSentryIntegrationConfig = vi.mocked(getSentryIntegrationConfig);
const mockBuildPromptContext = vi.mocked(buildPromptContext);
const mockCreateIntegrationChecker = vi.mocked(createIntegrationChecker);
const mockResolveEffectiveCapabilities = vi.mocked(resolveEffectiveCapabilities);
const mockGetAgentProfile = vi.mocked(getAgentProfile);

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
			projectSlug: 'api',
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

	it('filters native tool manifests and capabilities through effective capabilities', async () => {
		const checker = vi.fn().mockReturnValue(false);
		mockCreateIntegrationChecker.mockResolvedValueOnce(checker);
		mockResolveEffectiveCapabilities.mockReturnValueOnce(['fs:read']);
		const filterTools = vi.fn().mockReturnValue([{ name: 'ReadFile' }]);
		mockGetAgentProfile.mockReturnValueOnce({
			fetchContext: vi.fn().mockResolvedValue([]),
			finishHooks: {},
			lifecycleHooks: {},
			filterTools,
			allCapabilities: ['fs:read', 'pm:friction'],
			needsGitHubToken: false,
			buildTaskPrompt: () => 'task',
			capabilities: { required: ['fs:read'], optional: ['pm:friction'] },
			getLlmistGadgets: vi.fn(),
		});

		const plan = await buildExecutionPlan(
			'review',
			makeInput(makeProject(), 'manual'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			undefined,
			false,
			'claude-code',
			engine,
		);

		expect(mockResolveEffectiveCapabilities).toHaveBeenCalledWith(
			['fs:read'],
			['pm:friction'],
			checker,
		);
		expect(filterTools).toHaveBeenCalledWith(expect.any(Array), checker);
		expect(plan.nativeToolCapabilities).toEqual(['fs:read']);
		expect(plan.availableTools).toEqual([{ name: 'ReadFile' }]);
	});

	it('appends friction guidance only when pm:friction is effective', async () => {
		mockResolveEffectiveCapabilities.mockReturnValueOnce(['fs:read', 'pm:friction']);

		const withFriction = await buildExecutionPlan(
			'implementation',
			makeInput(makeProject(), 'manual'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			undefined,
			false,
			'claude-code',
			engine,
		);

		// 2026-05-10 rewrite: friction guidance is now action-trigger framed
		// without negative scoping — assert by the new content. Section
		// heading + the "when in doubt, report" calibration anchor + the
		// non-blocking semantic.
		expect(withFriction.systemPrompt).toContain('## Friction Reporting');
		expect(withFriction.systemPrompt).toContain('When in doubt, report');
		expect(withFriction.systemPrompt).toContain(
			'only let friction block your task if it actually blocks it',
		);

		mockResolveEffectiveCapabilities.mockReturnValueOnce(['fs:read']);

		const withoutFriction = await buildExecutionPlan(
			'review',
			makeInput(makeProject(), 'manual'),
			'/repo',
			noopLogWriter,
			noopAgentLogger,
			undefined,
			false,
			'claude-code',
			engine,
		);

		expect(withoutFriction.systemPrompt).not.toContain('Friction Reporting');
	});

	describe('review event policy prompt flag', () => {
		it('sets promptContext.commentOnlyReview=true for a comment-only review agent', async () => {
			mockBuildPromptContext.mockReturnValueOnce({});
			const project = makeProject({ agentReviewEventPolicies: { review: 'comment-only' } });

			await buildExecutionPlan(
				'review',
				makeInput(project, 'manual'),
				'/repo',
				noopLogWriter,
				noopAgentLogger,
				undefined,
				false,
				'claude-code',
				engine,
			);

			const promptContext = vi.mocked(resolveModelConfig).mock.calls[0][0].promptContext;
			expect(promptContext.commentOnlyReview).toBe(true);
		});

		it('sets promptContext.commentOnlyReview=false under the default policy', async () => {
			mockBuildPromptContext.mockReturnValueOnce({});

			await buildExecutionPlan(
				'review',
				makeInput(makeProject(), 'manual'),
				'/repo',
				noopLogWriter,
				noopAgentLogger,
				undefined,
				false,
				'claude-code',
				engine,
			);

			const promptContext = vi.mocked(resolveModelConfig).mock.calls[0][0].promptContext;
			expect(promptContext.commentOnlyReview).toBe(false);
		});

		it('sets promptContext.commentOnlyReview=false for non-review agents on a comment-only project', async () => {
			mockBuildPromptContext.mockReturnValueOnce({});
			const project = makeProject({ agentReviewEventPolicies: { review: 'comment-only' } });

			await buildExecutionPlan(
				'implementation',
				makeInput(project, 'manual'),
				'/repo',
				noopLogWriter,
				noopAgentLogger,
				undefined,
				false,
				'claude-code',
				engine,
			);

			const promptContext = vi.mocked(resolveModelConfig).mock.calls[0][0].promptContext;
			expect(promptContext.commentOnlyReview).toBe(false);
		});
	});

	// MNG-1685: the native-tool engine family (claude-code/codex/opencode) renders
	// plan.availableTools into the system-prompt tool list, so dropping the disabled
	// posting tool manifests here is the authoritative gate for that family.
	describe('update channel posting-tool gating', () => {
		const PM_POSTING = ['PostComment'];
		const SCM_POSTING = [
			'PostPRComment',
			'UpdatePRComment',
			'CreatePRReview',
			'ReplyToReviewComment',
		];
		// Action / read tools that must NEVER be dropped by channel gating.
		const NON_POSTING = ['ReadWorkItem', 'UpdateWorkItem', 'MoveWorkItem', 'CreatePR', 'ReadFile'];
		const ALL_TOOLS = [...NON_POSTING, ...PM_POSTING, ...SCM_POSTING].map((name) => ({ name }));

		function mockProfileWithTools(tools: Array<{ name: string }>) {
			mockGetAgentProfile.mockReturnValueOnce({
				fetchContext: vi.fn().mockResolvedValue([]),
				finishHooks: {},
				lifecycleHooks: {},
				filterTools: vi.fn().mockReturnValue(tools),
				allCapabilities: ['fs:read'],
				needsGitHubToken: false,
				buildTaskPrompt: () => 'task',
				capabilities: { required: ['fs:read'], optional: [] },
				getLlmistGadgets: vi.fn(),
			});
		}

		async function availableToolNamesFor(
			channel: UpdateChannel | undefined,
			tools: Array<{ name: string }> = ALL_TOOLS,
		): Promise<string[]> {
			mockProfileWithTools(tools);
			const project = makeProject(
				channel ? { agentUpdateChannels: { review: channel } } : undefined,
			);
			const plan = await buildExecutionPlan(
				'review',
				makeInput(project, 'manual'),
				'/repo',
				noopLogWriter,
				noopAgentLogger,
				undefined,
				false,
				'claude-code',
				engine,
			);
			return (plan.availableTools as Array<{ name: string }>).map((tool) => tool.name);
		}

		it("'both' retains every posting tool plus action tools", async () => {
			expect(await availableToolNamesFor('both')).toEqual([
				...NON_POSTING,
				...PM_POSTING,
				...SCM_POSTING,
			]);
		});

		it("'none' drops all PM and SCM posting tools, retaining everything else", async () => {
			const names = await availableToolNamesFor('none');
			expect(names).toEqual(NON_POSTING);
			for (const dropped of [...PM_POSTING, ...SCM_POSTING]) {
				expect(names).not.toContain(dropped);
			}
		});

		it("'pm-only' retains PM posting and drops SCM posting", async () => {
			expect(await availableToolNamesFor('pm-only')).toEqual([...NON_POSTING, ...PM_POSTING]);
		});

		it("'scm-only' retains SCM posting and drops PM posting", async () => {
			expect(await availableToolNamesFor('scm-only')).toEqual([...NON_POSTING, ...SCM_POSTING]);
		});

		it("defaults to 'both' (retains all posting tools) when no channel is configured", async () => {
			expect(await availableToolNamesFor(undefined)).toEqual([
				...NON_POSTING,
				...PM_POSTING,
				...SCM_POSTING,
			]);
		});

		it('no-ops gracefully when a disabled posting tool is already absent (layers on integration filtering)', async () => {
			// Integration-availability filtering already removed PostComment + SCM
			// posting (PM/SCM integration not configured). A channel that disables them
			// has nothing to drop and must neither error nor resurrect them.
			const names = await availableToolNamesFor('none', [
				{ name: 'ReadFile' },
				{ name: 'CreatePR' },
			]);
			expect(names).toEqual(['ReadFile', 'CreatePR']);
		});

		it('resolves the channel for the agent type being built', async () => {
			// review is disabled but implementation is 'both' — building 'implementation'
			// must read the implementation entry, not review's.
			mockProfileWithTools(ALL_TOOLS);
			const project = makeProject({
				agentUpdateChannels: { review: 'none', implementation: 'both' },
			});
			const plan = await buildExecutionPlan(
				'implementation',
				makeInput(project, 'manual'),
				'/repo',
				noopLogWriter,
				noopAgentLogger,
				undefined,
				false,
				'claude-code',
				engine,
			);
			const names = (plan.availableTools as Array<{ name: string }>).map((tool) => tool.name);
			expect(names).toEqual([...NON_POSTING, ...PM_POSTING, ...SCM_POSTING]);
		});
	});
});

describe('injectRunLinkSecrets', () => {
	it('injects runtime context but no dashboard link flags when runLinksEnabled is false', () => {
		mockGetDashboardUrl.mockReturnValue('https://dashboard.example.com');
		const project = makeProject({ runLinksEnabled: false });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets).toEqual({
			CASCADE_ENGINE_LABEL: 'claude-code',
			CASCADE_MODEL: 'test-model',
			CASCADE_PROJECT_ID: 'test-project',
			CASCADE_WORK_ITEM_ID: 'card123',
			CASCADE_RUN_ID: 'run-id-1',
		});
		expect(partialInput.projectSecrets?.CASCADE_RUN_LINKS_ENABLED).toBeUndefined();
		expect(partialInput.projectSecrets?.CASCADE_DASHBOARD_URL).toBeUndefined();
	});

	it('injects runtime context when dashboardUrl is absent', () => {
		mockGetDashboardUrl.mockReturnValue(undefined);
		const project = makeProject({ runLinksEnabled: true });
		const partialInput: { projectSecrets?: Record<string, string>; model?: string } = {
			model: 'test-model',
		};

		injectRunLinkSecrets(partialInput, project, 'claude-code', 'card123', 'run-id-1');

		expect(partialInput.projectSecrets).toEqual({
			CASCADE_ENGINE_LABEL: 'claude-code',
			CASCADE_MODEL: 'test-model',
			CASCADE_PROJECT_ID: 'test-project',
			CASCADE_WORK_ITEM_ID: 'card123',
			CASCADE_RUN_ID: 'run-id-1',
		});
		expect(partialInput.projectSecrets?.CASCADE_RUN_LINKS_ENABLED).toBeUndefined();
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
