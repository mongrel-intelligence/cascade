import { beforeEach, describe, expect, it } from 'vitest';
import { AgentDefinitionSchema } from '../../../src/agents/definitions/schema.js';
import type { AgentDefinition } from '../../../src/agents/definitions/schema.js';
import {
	deleteAgentDefinition,
	getAgentDefinition,
	listAgentDefinitions,
	upsertAgentDefinition,
} from '../../../src/db/repositories/agentDefinitionsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { MINIMAL_AGENT_DEFINITION, seedAgentDefinition } from '../helpers/seed.js';

describe('agentDefinitionsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// =========================================================================
	// upsertAgentDefinition — create
	// =========================================================================

	describe('upsertAgentDefinition (create)', () => {
		it('creates a new definition and can be retrieved', async () => {
			await upsertAgentDefinition('custom-agent', MINIMAL_AGENT_DEFINITION);

			const result = await getAgentDefinition('custom-agent');
			expect(result).not.toBeNull();
			expect(result?.identity.label).toBe('Test Agent');
			expect(result?.hints).toBeUndefined();
		});

		it('validates via AgentDefinitionSchema before inserting', async () => {
			// Upserting should succeed for a valid definition
			await expect(
				upsertAgentDefinition('validated-agent', MINIMAL_AGENT_DEFINITION),
			).resolves.not.toThrow();
		});

		it('rejects invalid definitions — missing required taskPrompt', async () => {
			const invalidDefinition = {
				...MINIMAL_AGENT_DEFINITION,
				prompts: { taskPrompt: '' }, // empty taskPrompt violates z.string().min(1)
			} as AgentDefinition;

			await expect(upsertAgentDefinition('invalid-agent', invalidDefinition)).rejects.toThrow();
		});

		it('rejects invalid definitions — missing required capabilities', async () => {
			const invalidDefinition = {
				identity: {
					emoji: '🤖',
					label: 'Bad Agent',
					roleHint: 'missing',
					initialMessage: 'hello',
				},
				// missing capabilities, triggers, strategies, hint, prompts
			} as unknown as AgentDefinition;

			await expect(upsertAgentDefinition('bad-agent', invalidDefinition)).rejects.toThrow();
		});

		it('stores isBuiltin as false by default', async () => {
			await upsertAgentDefinition('default-builtin-agent', MINIMAL_AGENT_DEFINITION);

			const list = await listAgentDefinitions();
			const entry = list.find((d) => d.agentType === 'default-builtin-agent');
			expect(entry).toBeDefined();
			expect(entry?.isBuiltin).toBe(false);
		});

		it('stores isBuiltin as true when explicitly set', async () => {
			await upsertAgentDefinition('builtin-agent', MINIMAL_AGENT_DEFINITION, true);

			const list = await listAgentDefinitions();
			const entry = list.find((d) => d.agentType === 'builtin-agent');
			expect(entry).toBeDefined();
			expect(entry?.isBuiltin).toBe(true);
		});
	});

	// =========================================================================
	// upsertAgentDefinition — update (conflict semantics)
	// =========================================================================

	describe('upsertAgentDefinition (update semantics)', () => {
		it('upserting same agentType updates definition, does not duplicate', async () => {
			await upsertAgentDefinition('shared-agent', MINIMAL_AGENT_DEFINITION);

			const updatedDefinition: AgentDefinition = {
				...MINIMAL_AGENT_DEFINITION,
				identity: {
					...MINIMAL_AGENT_DEFINITION.identity,
					label: 'Updated Label',
				},
			};
			await upsertAgentDefinition('shared-agent', updatedDefinition);

			const list = await listAgentDefinitions();
			const entries = list.filter((d) => d.agentType === 'shared-agent');
			expect(entries).toHaveLength(1);
			expect(entries[0].definition.identity.label).toBe('Updated Label');
		});

		it('upserting same agentType updates isBuiltin flag', async () => {
			await upsertAgentDefinition('flag-agent', MINIMAL_AGENT_DEFINITION, false);

			const listBefore = await listAgentDefinitions();
			const before = listBefore.find((d) => d.agentType === 'flag-agent');
			expect(before?.isBuiltin).toBe(false);

			await upsertAgentDefinition('flag-agent', MINIMAL_AGENT_DEFINITION, true);

			const listAfter = await listAgentDefinitions();
			const after = listAfter.find((d) => d.agentType === 'flag-agent');
			expect(after?.isBuiltin).toBe(true);
		});

		it('upserting multiple different agentTypes creates separate entries', async () => {
			await upsertAgentDefinition('agent-alpha', MINIMAL_AGENT_DEFINITION);
			await upsertAgentDefinition('agent-beta', {
				...MINIMAL_AGENT_DEFINITION,
				identity: { ...MINIMAL_AGENT_DEFINITION.identity, label: 'Beta Agent' },
			});

			const list = await listAgentDefinitions();
			const agentTypes = list.map((d) => d.agentType).sort();
			expect(agentTypes).toContain('agent-alpha');
			expect(agentTypes).toContain('agent-beta');
		});
	});

	// =========================================================================
	// getAgentDefinition
	// =========================================================================

	describe('getAgentDefinition', () => {
		it('returns null when no definition exists for the agentType', async () => {
			const result = await getAgentDefinition('nonexistent-agent');
			expect(result).toBeNull();
		});

		it('retrieves the inserted definition by agentType', async () => {
			await upsertAgentDefinition('get-test-agent', MINIMAL_AGENT_DEFINITION);

			const result = await getAgentDefinition('get-test-agent');
			expect(result).not.toBeNull();
			expect(result?.identity.label).toBe('Test Agent');
			expect(result?.hint).toBe('This is a test hint for iteration guidance.');
		});

		it('returns a Zod-parsed AgentDefinition (proper type)', async () => {
			await upsertAgentDefinition('parsed-agent', MINIMAL_AGENT_DEFINITION);

			const result = await getAgentDefinition('parsed-agent');
			// Validate that Zod defaults are applied (e.g., triggers defaults to [])
			expect(Array.isArray(result?.triggers)).toBe(true);
			// Should parse without error — i.e., it's a valid AgentDefinition
			expect(() => AgentDefinitionSchema.parse(result)).not.toThrow();
		});

		it('retrieves the correct definition when multiple agentTypes exist', async () => {
			await upsertAgentDefinition('agent-x', {
				...MINIMAL_AGENT_DEFINITION,
				identity: { ...MINIMAL_AGENT_DEFINITION.identity, label: 'Agent X' },
			});
			await upsertAgentDefinition('agent-y', {
				...MINIMAL_AGENT_DEFINITION,
				identity: { ...MINIMAL_AGENT_DEFINITION.identity, label: 'Agent Y' },
			});

			const x = await getAgentDefinition('agent-x');
			const y = await getAgentDefinition('agent-y');

			expect(x?.identity.label).toBe('Agent X');
			expect(y?.identity.label).toBe('Agent Y');
		});
	});

	// =========================================================================
	// listAgentDefinitions
	// =========================================================================

	describe('listAgentDefinitions', () => {
		it('returns empty array when no definitions exist', async () => {
			const list = await listAgentDefinitions();
			expect(list).toHaveLength(0);
		});

		it('returns all inserted definitions', async () => {
			await upsertAgentDefinition('list-agent-1', MINIMAL_AGENT_DEFINITION);
			await upsertAgentDefinition('list-agent-2', MINIMAL_AGENT_DEFINITION);

			const list = await listAgentDefinitions();
			expect(list).toHaveLength(2);
			const agentTypes = list.map((d) => d.agentType).sort();
			expect(agentTypes).toEqual(['list-agent-1', 'list-agent-2']);
		});

		it('returns entries with agentType, definition, and isBuiltin fields', async () => {
			await upsertAgentDefinition('list-fields-agent', MINIMAL_AGENT_DEFINITION, true);

			const list = await listAgentDefinitions();
			expect(list).toHaveLength(1);

			const entry = list[0];
			expect(entry.agentType).toBe('list-fields-agent');
			expect(entry.definition).toBeDefined();
			expect(entry.isBuiltin).toBe(true);
		});

		it('returns Zod-parsed definitions for each entry', async () => {
			await upsertAgentDefinition('list-zod-agent', MINIMAL_AGENT_DEFINITION);

			const list = await listAgentDefinitions();
			expect(list).toHaveLength(1);

			// Each definition should be parseable by AgentDefinitionSchema without error
			for (const entry of list) {
				expect(() => AgentDefinitionSchema.parse(entry.definition)).not.toThrow();
			}
		});
	});

	// =========================================================================
	// deleteAgentDefinition
	// =========================================================================

	describe('deleteAgentDefinition', () => {
		it('removes the definition by agentType', async () => {
			await upsertAgentDefinition('delete-me', MINIMAL_AGENT_DEFINITION);

			await deleteAgentDefinition('delete-me');

			const result = await getAgentDefinition('delete-me');
			expect(result).toBeNull();
		});

		it('does not affect other definitions when deleting one', async () => {
			await upsertAgentDefinition('keep-me', MINIMAL_AGENT_DEFINITION);
			await upsertAgentDefinition('delete-me-2', MINIMAL_AGENT_DEFINITION);

			await deleteAgentDefinition('delete-me-2');

			const list = await listAgentDefinitions();
			expect(list).toHaveLength(1);
			expect(list[0].agentType).toBe('keep-me');
		});

		it('is idempotent — deleting a non-existent agentType does not throw', async () => {
			await expect(deleteAgentDefinition('nonexistent-agent')).resolves.not.toThrow();
		});
	});

	// =========================================================================
	// Zod validation round-trip (JSONB)
	// =========================================================================

	describe('Zod validation round-trip', () => {
		it('round-trips a valid AgentDefinition through upsert and read', async () => {
			const definition: AgentDefinition = {
				...MINIMAL_AGENT_DEFINITION,
				identity: {
					emoji: '🔧',
					label: 'Round-trip Agent',
					roleHint: 'Tests round-trip fidelity',
					initialMessage: 'Starting round-trip test...',
				},
				capabilities: {
					required: ['fs:read', 'fs:write'],
					optional: ['pm:read'],
				},
				triggers: [
					{
						event: 'pm:status-changed',
						label: 'Status changed',
						defaultEnabled: false,
						parameters: [],
					},
				],
				hint: 'Round-trip hint.',
				prompts: {
					taskPrompt: 'Perform the round-trip task.',
					systemPrompt: 'You are a round-trip test agent.',
				},
			};

			await upsertAgentDefinition('round-trip-agent', definition);

			const retrieved = await getAgentDefinition('round-trip-agent');
			expect(retrieved).not.toBeNull();

			// Core identity fields
			expect(retrieved?.identity.emoji).toBe('🔧');
			expect(retrieved?.identity.label).toBe('Round-trip Agent');

			// Capabilities
			expect(retrieved?.capabilities.required).toContain('fs:read');
			expect(retrieved?.capabilities.required).toContain('fs:write');
			expect(retrieved?.capabilities.optional).toContain('pm:read');

			// Triggers
			expect(retrieved?.triggers).toHaveLength(1);
			expect(retrieved?.triggers[0].event).toBe('pm:status-changed');

			// Prompts
			expect(retrieved?.prompts.taskPrompt).toBe('Perform the round-trip task.');
			expect(retrieved?.prompts.systemPrompt).toBe('You are a round-trip test agent.');

			// Hint
			expect(retrieved?.hint).toBe('Round-trip hint.');
		});

		it('Zod applies defaults on read (e.g., triggers defaults to [])', async () => {
			// Insert a definition that will have triggers defaulted
			await upsertAgentDefinition('defaults-agent', MINIMAL_AGENT_DEFINITION);

			const result = await getAgentDefinition('defaults-agent');
			// triggers has a .default([]) in the schema
			expect(result?.triggers).toEqual([]);
		});

		it('rejects a definition with a capability not in the CAPABILITIES registry', async () => {
			const invalidDefinition = {
				...MINIMAL_AGENT_DEFINITION,
				capabilities: {
					required: ['fs:read', 'not-a-real:capability'],
					optional: [],
				},
			} as unknown as AgentDefinition;

			await expect(
				upsertAgentDefinition('invalid-capability-agent', invalidDefinition),
			).rejects.toThrow();
		});

		it('rejects a definition where a capability is both required and optional', async () => {
			const invalidDefinition = {
				...MINIMAL_AGENT_DEFINITION,
				capabilities: {
					required: ['fs:read'],
					optional: ['fs:read'], // same as required — violates refine
				},
			} as unknown as AgentDefinition;

			await expect(
				upsertAgentDefinition('duplicate-capability-agent', invalidDefinition),
			).rejects.toThrow();
		});
	});

	// =========================================================================
	// seedAgentDefinition helper
	// =========================================================================

	describe('seedAgentDefinition helper', () => {
		it('creates a definition that appears in listAgentDefinitions', async () => {
			await seedAgentDefinition({ agentType: 'seeded-agent' });

			const list = await listAgentDefinitions();
			const entry = list.find((d) => d.agentType === 'seeded-agent');
			expect(entry).toBeDefined();
			expect(entry?.definition.identity.label).toBe('Test Agent');
		});

		it('respects isBuiltin override', async () => {
			await seedAgentDefinition({ agentType: 'seeded-builtin', isBuiltin: true });

			const list = await listAgentDefinitions();
			const entry = list.find((d) => d.agentType === 'seeded-builtin');
			expect(entry?.isBuiltin).toBe(true);
		});

		it('respects definition overrides', async () => {
			await seedAgentDefinition({
				agentType: 'seeded-custom',
				definition: {
					identity: {
						emoji: '⭐',
						label: 'Custom Seeded Agent',
						roleHint: 'Custom role',
						initialMessage: 'Custom message',
					},
				},
			});

			const result = await getAgentDefinition('seeded-custom');
			expect(result?.identity.label).toBe('Custom Seeded Agent');
			expect(result?.identity.emoji).toBe('⭐');
		});

		it('defaults agentType to "test-agent" when not specified', async () => {
			await seedAgentDefinition();

			const result = await getAgentDefinition('test-agent');
			expect(result).not.toBeNull();
		});
	});
});
