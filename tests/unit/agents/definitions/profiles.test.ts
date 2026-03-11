import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveAgentDefinition, mockBuildGadgetsForAgent } = vi.hoisted(() => ({
	mockResolveAgentDefinition: vi.fn(),
	mockBuildGadgetsForAgent: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	resolveAgentDefinition: mockResolveAgentDefinition,
}));

vi.mock('../../../../src/agents/shared/gadgets.js', () => ({
	buildGadgetsForAgent: mockBuildGadgetsForAgent,
}));

vi.mock('../../../../src/agents/capabilities/resolver.js', () => ({
	deriveRequiredIntegrations: vi.fn().mockReturnValue([]),
	getGadgetNamesFromCapabilities: vi.fn().mockReturnValue(['ReadFile', 'WriteFile']),
	getSdkToolsFromCapabilities: vi.fn().mockReturnValue(['Read', 'Write']),
	resolveEffectiveCapabilities: vi.fn().mockImplementation((req, opt) => [...req, ...opt]),
}));

vi.mock('../../../../src/agents/prompts/index.js', () => ({
	buildTaskPromptContext: vi.fn().mockReturnValue({ task: 'implement' }),
	renderInlineTaskPrompt: vi.fn().mockReturnValue('Rendered task prompt'),
	validateTemplate: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('../../../../src/agents/definitions/strategies.js', () => ({
	CONTEXT_STEP_REGISTRY: {},
}));

import {
	getAgentProfile,
	needsGitStateStopHooks,
} from '../../../../src/agents/definitions/profiles.js';

function makeDefinition(overrides: Record<string, unknown> = {}) {
	return {
		capabilities: {
			required: ['file-system'],
			optional: ['trello'],
		},
		strategies: {
			gadgetOptions: {},
		},
		prompts: {
			taskPrompt: 'Implement: <%= it.task %>',
		},
		triggers: [
			{
				event: 'pm:status-changed',
				label: 'Status Changed',
				defaultEnabled: true,
				parameters: [],
				contextPipeline: [],
			},
		],
		integrations: undefined,
		hooks: undefined,
		...overrides,
	};
}

describe('getAgentProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockBuildGadgetsForAgent.mockReturnValue([]);
	});

	it('throws when agent definition cannot be loaded', async () => {
		mockResolveAgentDefinition.mockRejectedValue(new Error('Not found'));

		await expect(getAgentProfile('unknown-agent')).rejects.toThrow(
			"Failed to load agent profile for 'unknown-agent'",
		);
	});

	it('returns profile with sdkTools from capabilities', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');

		expect(profile.sdkTools).toEqual(['Read', 'Write']);
	});

	it('returns needsGitHubToken=false when no scm integration required', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');

		expect(profile.needsGitHubToken).toBe(false);
	});

	it('returns needsGitHubToken=true when scm is in explicit integrations', async () => {
		const { deriveRequiredIntegrations } = await import(
			'../../../../src/agents/capabilities/resolver.js'
		);
		vi.mocked(deriveRequiredIntegrations).mockReturnValue(['scm']);

		mockResolveAgentDefinition.mockResolvedValue(
			makeDefinition({ integrations: { required: ['scm'] } }),
		);

		const profile = await getAgentProfile('implementation');

		expect(profile.needsGitHubToken).toBe(true);

		// Restore
		vi.mocked(deriveRequiredIntegrations).mockReturnValue([]);
	});

	it('filterTools filters by capability-derived gadget names', async () => {
		const { getGadgetNamesFromCapabilities } = await import(
			'../../../../src/agents/capabilities/resolver.js'
		);
		vi.mocked(getGadgetNamesFromCapabilities).mockReturnValue(['ReadFile', 'WriteFile']);

		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');
		const allTools = [
			{ name: 'ReadFile', description: 'Read a file', inputSchema: {} },
			{ name: 'WriteFile', description: 'Write a file', inputSchema: {} },
			{ name: 'Tmux', description: 'Run commands', inputSchema: {} },
		];

		const filtered = profile.filterTools(allTools);

		expect(filtered).toHaveLength(2);
		expect(filtered.map((t) => t.name)).toEqual(['ReadFile', 'WriteFile']);
	});

	it('buildTaskPrompt returns rendered prompt', async () => {
		const { renderInlineTaskPrompt } = await import('../../../../src/agents/prompts/index.js');
		vi.mocked(renderInlineTaskPrompt).mockReturnValue('Built prompt for card-1');

		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');
		const result = profile.buildTaskPrompt({
			cardId: 'card-1',
		} as Parameters<typeof profile.buildTaskPrompt>[0]);

		expect(result).toBe('Built prompt for card-1');
	});

	it('fetchContext returns empty array when no triggerType', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');
		const result = await profile.fetchContext({
			input: {},
		} as Parameters<typeof profile.fetchContext>[0]);

		expect(result).toEqual([]);
	});

	it('getLlmistGadgets calls buildGadgetsForAgent', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockBuildGadgetsForAgent.mockReturnValue(['gadget1', 'gadget2']);

		const profile = await getAgentProfile('implementation');
		const gadgets = profile.getLlmistGadgets();

		expect(mockBuildGadgetsForAgent).toHaveBeenCalled();
		expect(gadgets).toEqual(['gadget1', 'gadget2']);
	});

	it('getLlmistGadgets with integrationChecker uses resolveEffectiveCapabilities', async () => {
		const { resolveEffectiveCapabilities } = await import(
			'../../../../src/agents/capabilities/resolver.js'
		);
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');
		const checker = vi.fn().mockReturnValue(true);
		profile.getLlmistGadgets(checker);

		expect(resolveEffectiveCapabilities).toHaveBeenCalledWith(
			expect.any(Array),
			expect.any(Array),
			checker,
		);
	});

	it('returns capabilities from definition', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');

		expect(profile.capabilities).toEqual({
			required: ['file-system'],
			optional: ['trello'],
		});
	});

	it('returns empty finishHooks when hooks not defined', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition({ hooks: undefined }));

		const profile = await getAgentProfile('implementation');

		expect(profile.finishHooks).toEqual({
			requiresPR: undefined,
			requiresReview: undefined,
			requiresPushedChanges: undefined,
			blockGitPush: undefined,
		});
	});

	it('returns finishHooks from definition hooks.finish.scm', async () => {
		mockResolveAgentDefinition.mockResolvedValue(
			makeDefinition({
				hooks: {
					finish: {
						scm: { requiresPR: true, requiresReview: false, requiresPushedChanges: true },
					},
				},
			}),
		);

		const profile = await getAgentProfile('implementation');

		expect(profile.finishHooks.requiresPR).toBe(true);
		expect(profile.finishHooks.requiresReview).toBe(false);
		expect(profile.finishHooks.requiresPushedChanges).toBe(true);
	});
});

describe('needsGitStateStopHooks', () => {
	it('returns false when all hooks are undefined', () => {
		expect(needsGitStateStopHooks({})).toBe(false);
	});

	it('returns true when requiresPR is true', () => {
		expect(needsGitStateStopHooks({ requiresPR: true })).toBe(true);
	});

	it('returns false when only requiresReview is true (review validation is post-session)', () => {
		expect(needsGitStateStopHooks({ requiresReview: true })).toBe(false);
	});

	it('returns true when requiresPushedChanges is true', () => {
		expect(needsGitStateStopHooks({ requiresPushedChanges: true })).toBe(true);
	});

	it('returns false when only blockGitPush is true (no validation required)', () => {
		expect(needsGitStateStopHooks({ blockGitPush: true })).toBe(false);
	});
});
