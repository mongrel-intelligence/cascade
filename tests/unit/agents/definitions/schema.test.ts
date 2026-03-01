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
			required: ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl', 'pm:read', 'pm:write'],
			optional: [],
		},
		strategies: {
			contextPipeline: ['directoryListing', 'contextFiles', 'squint', 'workItem'],
			taskPromptBuilder: 'workItem',
		},
		backend: {
			enableStopHooks: false,
			needsGitHubToken: false,
		},
		compaction: 'default',
		hint: 'Do the thing efficiently.',
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
				gadgetOptions: { includeReviewComments: true },
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

	it('rejects invalid capability names', () => {
		const bad = {
			...validDefinition,
			capabilities: { required: ['invalid:cap'], optional: [] },
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

	it('rejects overlapping required and optional capabilities', () => {
		const bad = {
			...validDefinition,
			capabilities: {
				required: ['fs:read', 'pm:read'],
				optional: ['fs:read'], // fs:read is in both
			},
		};
		const result = AgentDefinitionSchema.safeParse(bad);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('cannot be both required and optional');
		}
	});

	it('allows optional capabilities to be omitted', () => {
		const withoutOptional = {
			...validDefinition,
			capabilities: {
				required: ['fs:read', 'session:ctrl'],
			},
		};
		const result = AgentDefinitionSchema.safeParse(withoutOptional);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.capabilities.optional).toEqual([]);
		}
	});

	it('accepts valid optional capabilities', () => {
		const withOptional = {
			...validDefinition,
			capabilities: {
				required: ['fs:read', 'session:ctrl', 'scm:read'],
				optional: ['pm:read', 'pm:write'],
			},
		};
		const result = AgentDefinitionSchema.safeParse(withOptional);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.capabilities.optional).toEqual(['pm:read', 'pm:write']);
		}
	});
});
