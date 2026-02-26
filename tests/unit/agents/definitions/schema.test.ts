import { describe, expect, it } from 'vitest';
import { AgentDefinitionSchema } from '../../../../src/agents/definitions/schema.js';

describe('AgentDefinitionSchema', () => {
	const validDefinition = {
		identity: {
			emoji: '🔧',
			label: 'Test Agent',
			roleHint: 'Does test things',
			initialMessage: '**🔧 Testing** — Running tests...',
		},
		capabilities: {
			canEditFiles: true,
			canCreatePR: false,
			canUpdateChecklists: true,
			isReadOnly: false,
		},
		tools: {
			sets: ['pm', 'session'],
			sdkTools: 'all',
		},
		strategies: {
			contextPipeline: ['directoryListing', 'contextFiles', 'squint', 'workItem'],
			taskPromptBuilder: 'workItem',
			gadgetBuilder: 'workItem',
		},
		backend: {
			enableStopHooks: false,
			needsGitHubToken: false,
		},
		compaction: 'default',
		hint: 'Do the thing efficiently.',
		integrations: {
			required: ['pm'],
			optional: [],
		},
	};

	it('parses a valid minimal definition', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
	});

	it('parses a definition with all optional fields', () => {
		const full = {
			...validDefinition,
			strategies: {
				...validDefinition.strategies,
				gadgetBuilderOptions: { includeReviewComments: true },
			},
			backend: {
				...validDefinition.backend,
				blockGitPush: false,
				preExecute: 'postInitialPRComment',
				postConfigure: 'sequentialGadgetExecution',
			},
			trailingMessage: {
				includeDiagnostics: true,
				includeTodoProgress: true,
				includeGitStatus: true,
				includePRStatus: true,
				includeReminder: true,
			},
		};

		const result = AgentDefinitionSchema.safeParse(full);
		expect(result.success).toBe(true);
	});

	it('rejects missing required fields', () => {
		const { identity: _, ...missing } = validDefinition;
		const result = AgentDefinitionSchema.safeParse(missing);
		expect(result.success).toBe(false);
	});

	it('rejects invalid tool set names', () => {
		const bad = {
			...validDefinition,
			tools: { sets: ['invalid_set'], sdkTools: 'all' },
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('rejects invalid sdkTools values', () => {
		const bad = {
			...validDefinition,
			tools: { sets: ['pm'], sdkTools: 'invalid' },
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('rejects invalid strategy names', () => {
		const bad = {
			...validDefinition,
			strategies: { ...validDefinition.strategies, contextPipeline: ['nonexistentStep'] },
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('rejects invalid compaction preset names', () => {
		const bad = { ...validDefinition, compaction: 'aggressive' };
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('allows trailingMessage to be omitted', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.trailingMessage).toBeUndefined();
		}
	});

	it('rejects invalid preExecute hook names', () => {
		const bad = {
			...validDefinition,
			backend: { ...validDefinition.backend, preExecute: 'typoInHookName' },
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('accepts valid preExecute hook name', () => {
		const good = {
			...validDefinition,
			backend: { ...validDefinition.backend, preExecute: 'postInitialPRComment' },
		};
		const result = AgentDefinitionSchema.safeParse(good);
		expect(result.success).toBe(true);
	});

	it('rejects invalid postConfigure hook names', () => {
		const bad = {
			...validDefinition,
			backend: { ...validDefinition.backend, postConfigure: 'nonexistentHook' },
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
	});

	it('accepts valid postConfigure hook name', () => {
		const good = {
			...validDefinition,
			backend: { ...validDefinition.backend, postConfigure: 'sequentialGadgetExecution' },
		};
		const result = AgentDefinitionSchema.safeParse(good);
		expect(result.success).toBe(true);
	});

	it('accepts requiresPR boolean', () => {
		const good = {
			...validDefinition,
			backend: { ...validDefinition.backend, requiresPR: true },
		};
		const result = AgentDefinitionSchema.safeParse(good);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.backend.requiresPR).toBe(true);
		}
	});

	it('allows requiresPR to be omitted', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.backend.requiresPR).toBeUndefined();
		}
	});

	it('validates contextPipeline step names', () => {
		const good = {
			...validDefinition,
			strategies: {
				...validDefinition.strategies,
				contextPipeline: ['prContext', 'prConversation', 'directoryListing'],
			},
		};
		const result = AgentDefinitionSchema.safeParse(good);
		expect(result.success).toBe(true);
	});

	it('rejects overlapping required and optional categories', () => {
		const bad = {
			...validDefinition,
			integrations: {
				required: ['pm', 'scm'],
				optional: ['pm'], // pm is in both
			},
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('cannot be both required and optional');
		}
	});
});
