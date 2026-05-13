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
	resolveEffectiveCapabilities: vi.fn().mockImplementation((req, opt) => [...req, ...opt]),
}));

vi.mock('../../../../src/agents/prompts/index.js', () => ({
	buildTaskPromptContext: vi.fn().mockReturnValue({ task: 'implement' }),
	renderInlineTaskPrompt: vi.fn().mockReturnValue('Rendered task prompt'),
	validateTemplate: vi.fn().mockReturnValue({ valid: true }),
}));

const mockPipelineSnapshotStep = vi.fn();
const mockWorkItemStep = vi.fn();
vi.mock('../../../../src/agents/definitions/strategies.js', () => ({
	CONTEXT_STEP_REGISTRY: {
		pipelineSnapshot: (...args: unknown[]) => mockPipelineSnapshotStep(...args),
		workItem: (...args: unknown[]) => mockWorkItemStep(...args),
	},
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
		mockBuildGadgetsForAgent.mockReturnValue([]);
	});

	it('throws when agent definition cannot be loaded', async () => {
		mockResolveAgentDefinition.mockRejectedValue(new Error('Not found'));

		await expect(getAgentProfile('unknown-agent')).rejects.toThrow(
			"Failed to load agent profile for 'unknown-agent'",
		);
	});

	it('returns profile with allCapabilities from capabilities', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const profile = await getAgentProfile('implementation');

		expect(profile.allCapabilities).toEqual(['file-system', 'trello']);
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

	// ============================================================================
	// requiredContext (Fix A + Fix C — backlog-manager scope safety)
	//
	// `requiredContext` is an agent-level array of context steps that:
	// 1. ALWAYS run, regardless of whether the trigger has its own contextPipeline
	//    or whether triggerEvent is undefined (manual trigger).
	// 2. MUST produce >0 injections, otherwise the agent run aborts with a
	//    structured error.
	//
	// Closes the prod incident on 2026-04-29 where backlog-manager was manually
	// triggered with `triggerEvent: undefined`, ran with no pipelineSnapshot
	// pre-load, freelanced by listing all PM containers, and moved cards from
	// SPLITTING to TODO.
	// ============================================================================

	describe('requiredContext (always-run, fail-closed)', () => {
		beforeEach(() => {
			mockPipelineSnapshotStep.mockReset();
			mockWorkItemStep.mockReset();
		});

		it('runs requiredContext steps even when triggerEvent is undefined (manual trigger)', async () => {
			// Regression pin against the 2026-04-29 incident: manual `cascade runs
			// trigger --agent-type backlog-manager` ran with NO pipelineSnapshot
			// because resolveContextPipeline returned [] for undefined triggerEvent.
			mockPipelineSnapshotStep.mockResolvedValue([
				{ toolName: 'PipelineSnapshotSummary', params: {}, result: 'ok', description: 'snapshot' },
			]);
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({ requiredContext: ['pipelineSnapshot'] }),
			);

			const profile = await getAgentProfile('backlog-manager');
			const result = await profile.fetchContext({
				input: {}, // no triggerEvent — manual trigger
			} as Parameters<typeof profile.fetchContext>[0]);

			expect(mockPipelineSnapshotStep).toHaveBeenCalledOnce();
			expect(result).toHaveLength(1);
			expect(result[0].toolName).toBe('PipelineSnapshotSummary');
		});

		it('aborts with a structured error when a requiredContext step returns 0 injections', async () => {
			// Fix C: fail-closed. Today fetchPipelineSnapshotStep returns [] when
			// no PM provider is in scope — agent runs with no snapshot and
			// freelances. Required-step empty result must abort the run.
			mockPipelineSnapshotStep.mockResolvedValue([]);
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({ requiredContext: ['pipelineSnapshot'] }),
			);

			const profile = await getAgentProfile('backlog-manager');

			await expect(
				profile.fetchContext({
					input: {},
				} as Parameters<typeof profile.fetchContext>[0]),
			).rejects.toThrow(/required context step.*pipelineSnapshot/i);
		});

		it('aborts with a structured error when a requiredContext step throws', async () => {
			mockPipelineSnapshotStep.mockRejectedValue(new Error('PM provider unavailable'));
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({ requiredContext: ['pipelineSnapshot'] }),
			);

			const profile = await getAgentProfile('backlog-manager');

			await expect(
				profile.fetchContext({
					input: {},
				} as Parameters<typeof profile.fetchContext>[0]),
			).rejects.toThrow(/PM provider unavailable|required context step/i);
		});

		it('does not double-run a step that is in BOTH requiredContext and the trigger pipeline', async () => {
			// Avoid duplicate snapshot fetch when a webhook trigger (e.g.
			// scm:pr-merged) lists pipelineSnapshot in its contextPipeline AND
			// the agent declares it as requiredContext.
			mockPipelineSnapshotStep.mockResolvedValue([
				{ toolName: 'PipelineSnapshotSummary', params: {}, result: 'ok', description: 'snapshot' },
			]);
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({
					requiredContext: ['pipelineSnapshot'],
					triggers: [
						{
							event: 'scm:pr-merged',
							label: 'PR Merged',
							defaultEnabled: false,
							parameters: [],
							contextPipeline: ['pipelineSnapshot'],
						},
					],
				}),
			);

			const profile = await getAgentProfile('backlog-manager');
			await profile.fetchContext({
				input: { triggerEvent: 'scm:pr-merged' },
			} as Parameters<typeof profile.fetchContext>[0]);

			expect(mockPipelineSnapshotStep).toHaveBeenCalledOnce();
		});

		it('runs requiredContext FIRST, then non-required trigger pipeline steps', async () => {
			const order: string[] = [];
			mockPipelineSnapshotStep.mockImplementation(async () => {
				order.push('pipelineSnapshot');
				return [
					{
						toolName: 'PipelineSnapshotSummary',
						params: {},
						result: 'ok',
						description: 'snapshot',
					},
				];
			});
			mockWorkItemStep.mockImplementation(async () => {
				order.push('workItem');
				return [];
			});
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({
					requiredContext: ['pipelineSnapshot'],
					triggers: [
						{
							event: 'pm:status-changed',
							label: 'Status Changed',
							defaultEnabled: true,
							parameters: [],
							contextPipeline: ['workItem'],
						},
					],
				}),
			);

			const profile = await getAgentProfile('backlog-manager');
			await profile.fetchContext({
				input: { triggerEvent: 'pm:status-changed' },
			} as Parameters<typeof profile.fetchContext>[0]);

			expect(order).toEqual(['pipelineSnapshot', 'workItem']);
		});

		it('preserves existing behavior: agents without requiredContext are unaffected', async () => {
			mockResolveAgentDefinition.mockResolvedValue(
				makeDefinition({
					// No requiredContext field
					triggers: [
						{
							event: 'pm:status-changed',
							label: 'Status Changed',
							defaultEnabled: true,
							parameters: [],
							contextPipeline: [],
						},
					],
				}),
			);

			const profile = await getAgentProfile('implementation');
			const result = await profile.fetchContext({
				input: { triggerEvent: 'pm:status-changed' },
			} as Parameters<typeof profile.fetchContext>[0]);

			expect(result).toEqual([]);
			expect(mockPipelineSnapshotStep).not.toHaveBeenCalled();
		});
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
