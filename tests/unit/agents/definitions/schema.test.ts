import { describe, expect, it } from 'vitest';
import {
	AgentDefinitionSchema,
	IntegrationRequirementsSchema,
	KnownProviderSchema,
	SupportedTriggerSchema,
	TriggerParameterSchema,
} from '../../../../src/agents/definitions/schema.js';

// ============================================================================
// TriggerParameterSchema Tests
// ============================================================================

describe.concurrent('TriggerParameterSchema', () => {
	it('parses a valid string parameter', () => {
		const param = {
			name: 'senderEmail',
			type: 'string',
			label: 'Sender Email',
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(true);
	});

	it('parses a valid select parameter with options', () => {
		const param = {
			name: 'targetList',
			type: 'select',
			label: 'Target List',
			options: ['todo', 'planning', 'splitting'],
			defaultValue: 'todo',
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(true);
	});

	it('parses a valid boolean parameter', () => {
		const param = {
			name: 'enabled',
			type: 'boolean',
			label: 'Enabled',
			defaultValue: true,
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(true);
	});

	it('rejects defaultValue type mismatch (boolean expected, string given)', () => {
		const param = {
			name: 'enabled',
			type: 'boolean',
			label: 'Enabled',
			defaultValue: 'true', // Should be boolean
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain(
				'defaultValue type must match parameter type',
			);
		}
	});

	it('rejects defaultValue type mismatch (string expected, boolean given)', () => {
		const param = {
			name: 'target',
			type: 'select',
			label: 'Target',
			options: ['a', 'b'],
			defaultValue: true, // Should be string
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain(
				'defaultValue type must match parameter type',
			);
		}
	});

	it('rejects required parameter with defaultValue', () => {
		const param = {
			name: 'target',
			type: 'select',
			label: 'Target',
			options: ['a', 'b'],
			defaultValue: 'a',
			required: true, // Contradiction
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain(
				'Parameter with defaultValue cannot be required',
			);
		}
	});

	it('allows required parameter without defaultValue', () => {
		const param = {
			name: 'target',
			type: 'select',
			label: 'Target',
			options: ['a', 'b'],
			required: true,
		};
		const result = TriggerParameterSchema.safeParse(param);
		expect(result.success).toBe(true);
	});
});

// ============================================================================
// SupportedTriggerSchema Tests
// ============================================================================

describe.concurrent('SupportedTriggerSchema', () => {
	it('parses a valid trigger with event format pm:status-changed', () => {
		const trigger = {
			event: 'pm:status-changed',
			label: 'Status Changed',
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(true);
	});

	it('parses a valid trigger with event format scm:check-suite-success', () => {
		const trigger = {
			event: 'scm:check-suite-success',
			label: 'CI Passed',
			providers: ['github'],
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(true);
	});

	it('rejects invalid event format (missing category)', () => {
		const trigger = {
			event: 'card-moved', // Missing category prefix
			label: 'Card Moved',
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('Event must be in format');
		}
	});

	it('parses a valid trigger with internal: category prefix', () => {
		const trigger = {
			event: 'internal:auto-chain',
			label: 'Auto-Chain',
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(true);
	});

	it('rejects invalid event format (invalid category)', () => {
		const trigger = {
			event: 'invalid:card-moved', // Invalid category
			label: 'Card Moved',
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(false);
	});

	it('rejects invalid event format (uppercase)', () => {
		const trigger = {
			event: 'PM:Card-Moved', // Must be lowercase
			label: 'Card Moved',
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(false);
	});

	it('rejects invalid provider', () => {
		const trigger = {
			event: 'pm:status-changed',
			label: 'Card Moved',
			providers: ['invalid-provider'], // Unknown provider
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(false);
	});

	it('accepts all valid providers', () => {
		const trigger = {
			event: 'pm:status-changed',
			label: 'Card Moved',
			providers: ['trello', 'jira', 'github'],
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(true);
	});

	it('parses trigger with parameters', () => {
		const trigger = {
			event: 'pm:status-changed',
			label: 'Card Moved to Todo',
			parameters: [
				{
					name: 'targetList',
					type: 'select',
					label: 'Target List',
					options: ['todo'],
					defaultValue: 'todo',
				},
			],
		};
		const result = SupportedTriggerSchema.safeParse(trigger);
		expect(result.success).toBe(true);
	});
});

// ============================================================================
// KnownProviderSchema Tests
// ============================================================================

describe.concurrent('KnownProviderSchema', () => {
	it('accepts trello', () => {
		expect(KnownProviderSchema.safeParse('trello').success).toBe(true);
	});

	it('accepts jira', () => {
		expect(KnownProviderSchema.safeParse('jira').success).toBe(true);
	});

	it('accepts github', () => {
		expect(KnownProviderSchema.safeParse('github').success).toBe(true);
	});

	it('rejects unknown providers', () => {
		expect(KnownProviderSchema.safeParse('gitlab').success).toBe(false);
		expect(KnownProviderSchema.safeParse('asana').success).toBe(false);
		expect(KnownProviderSchema.safeParse('imap').success).toBe(false);
		expect(KnownProviderSchema.safeParse('gmail').success).toBe(false);
	});
});

// ============================================================================
// IntegrationRequirementsSchema Tests
// ============================================================================

describe.concurrent('IntegrationRequirementsSchema', () => {
	it('parses valid integration requirements', () => {
		const requirements = {
			required: ['pm'],
			optional: ['scm'],
		};
		const result = IntegrationRequirementsSchema.safeParse(requirements);
		expect(result.success).toBe(true);
	});

	it('defaults to empty arrays', () => {
		const result = IntegrationRequirementsSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.required).toEqual([]);
			expect(result.data.optional).toEqual([]);
		}
	});

	it('rejects overlapping required and optional integrations', () => {
		const requirements = {
			required: ['pm', 'scm'],
			optional: ['pm'], // pm is in both
		};
		const result = IntegrationRequirementsSchema.safeParse(requirements);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('cannot be both required and optional');
		}
	});

	it('rejects invalid integration categories', () => {
		const requirements = {
			required: ['invalid'],
			optional: [],
		};
		const result = IntegrationRequirementsSchema.safeParse(requirements);
		expect(result.success).toBe(false);
	});

	it('accepts all valid integration categories', () => {
		const requirements = {
			required: ['pm'],
			optional: ['scm'],
		};
		const result = IntegrationRequirementsSchema.safeParse(requirements);
		expect(result.success).toBe(true);
	});
});

// ============================================================================
// AgentDefinitionSchema Tests
// ============================================================================

describe.concurrent('AgentDefinitionSchema', () => {
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
		strategies: {},
		hint: 'Do the thing efficiently.',
		prompts: {
			taskPrompt: 'Analyze and process the work item with ID: <%= it.cardId %>.',
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
				gadgetOptions: { includeReviewComments: true },
			},
			hooks: {
				trailing: {
					scm: { gitStatus: true, prStatus: true },
					builtin: { diagnostics: true, todoProgress: true, reminder: true },
				},
				finish: {
					scm: { requiresPR: true, blockGitPush: false },
				},
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

	it('allows hooks to be omitted', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.hooks).toBeUndefined();
		}
	});

	it('accepts requiresPR boolean in hooks.finish.scm', () => {
		const good = {
			...validDefinition,
			hooks: { finish: { scm: { requiresPR: true } } },
		};
		const result = AgentDefinitionSchema.safeParse(good);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.hooks?.finish?.scm?.requiresPR).toBe(true);
		}
	});

	it('allows requiresPR to be omitted', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.hooks?.finish?.scm?.requiresPR).toBeUndefined();
		}
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

	it('accepts definition with valid triggers', () => {
		const withTriggers = {
			...validDefinition,
			triggers: [
				{
					event: 'pm:status-changed',
					label: 'Card Moved to Todo',
					defaultEnabled: true,
					providers: ['trello'],
					parameters: [
						{
							name: 'targetList',
							type: 'select',
							label: 'Target List',
							options: ['todo'],
							defaultValue: 'todo',
						},
					],
				},
			],
		};
		const result = AgentDefinitionSchema.safeParse(withTriggers);
		expect(result.success).toBe(true);
	});

	it('accepts definition with valid integrations', () => {
		const withIntegrations = {
			...validDefinition,
			integrations: {
				required: ['pm'],
				optional: ['scm'],
			},
		};
		const result = AgentDefinitionSchema.safeParse(withIntegrations);
		expect(result.success).toBe(true);
	});

	it('rejects definition with invalid trigger event format', () => {
		const badTrigger = {
			...validDefinition,
			triggers: [
				{
					event: 'invalid-event-format', // Missing category prefix
					label: 'Bad Trigger',
				},
			],
		};
		const result = AgentDefinitionSchema.safeParse(badTrigger);
		expect(result.success).toBe(false);
	});

	it('rejects definition with overlapping integrations', () => {
		const overlappingIntegrations = {
			...validDefinition,
			integrations: {
				required: ['pm'],
				optional: ['pm'], // Overlaps with required
			},
		};
		const result = AgentDefinitionSchema.safeParse(overlappingIntegrations);
		expect(result.success).toBe(false);
	});

	it('defaults triggers to empty array when not provided', () => {
		const result = AgentDefinitionSchema.safeParse(validDefinition);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.triggers).toEqual([]);
		}
	});
});
