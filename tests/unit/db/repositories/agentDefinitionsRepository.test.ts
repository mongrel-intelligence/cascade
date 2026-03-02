import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

// Mock the DB client
vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import { getDb } from '../../../../src/db/client.js';
import {
	deleteAgentDefinition,
	getAgentDefinition,
	listAgentDefinitions,
	upsertAgentDefinition,
} from '../../../../src/db/repositories/agentDefinitionsRepository.js';

const mockDefinition: AgentDefinition = {
	identity: {
		emoji: '🤖',
		label: 'Test Agent',
		roleHint: 'A test agent',
		initialMessage: 'Hello',
	},
	capabilities: {
		required: ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl', 'pm:read', 'pm:write'],
		optional: [],
	},
	strategies: {
		contextPipeline: ['workItem'],
	},
	backend: {
		enableStopHooks: false,
		blockGitPush: false,
	},
	hint: 'test hint',
	trailingMessage: undefined,
	prompts: {
		taskPrompt:
			'Analyze and process the work item with ID: <%= it.cardId %>. The work item data has been pre-loaded.',
	},
};

describe('agentDefinitionsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	describe('getAgentDefinition', () => {
		it('returns parsed AgentDefinition when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ agentType: 'implementation', definition: mockDefinition },
			]);

			const result = await getAgentDefinition('implementation');
			expect(result).not.toBeNull();
			expect(result?.identity.label).toBe('Test Agent');
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getAgentDefinition('nonexistent');
			expect(result).toBeNull();
		});

		it('throws when definition fails Zod validation', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ agentType: 'bad', definition: { invalid: 'data' } },
			]);

			await expect(getAgentDefinition('bad')).rejects.toThrow();
		});
	});

	describe('listAgentDefinitions', () => {
		it('returns all agent definitions with parsed data', async () => {
			mockDb.chain.from.mockResolvedValueOnce([
				{ agentType: 'implementation', definition: mockDefinition, isBuiltin: true },
				{ agentType: 'review', definition: mockDefinition, isBuiltin: false },
			]);

			const result = await listAgentDefinitions();
			expect(result).toHaveLength(2);
			expect(result[0].agentType).toBe('implementation');
			expect(result[0].isBuiltin).toBe(true);
			expect(result[0].definition.identity.label).toBe('Test Agent');
			expect(result[1].agentType).toBe('review');
			expect(result[1].isBuiltin).toBe(false);
		});

		it('returns empty array when no definitions exist', async () => {
			mockDb.chain.from.mockResolvedValueOnce([]);

			const result = await listAgentDefinitions();
			expect(result).toEqual([]);
		});

		it('defaults isBuiltin to false when null', async () => {
			mockDb.chain.from.mockResolvedValueOnce([
				{ agentType: 'test', definition: mockDefinition, isBuiltin: null },
			]);

			const result = await listAgentDefinitions();
			expect(result[0].isBuiltin).toBe(false);
		});
	});

	describe('upsertAgentDefinition', () => {
		it('inserts or updates a definition with Zod validation', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([]);

			await upsertAgentDefinition('implementation', mockDefinition, true);

			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					agentType: 'implementation',
					isBuiltin: true,
				}),
			);
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					set: expect.objectContaining({
						isBuiltin: true,
					}),
				}),
			);
		});

		it('defaults isBuiltin to false when not provided', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([]);

			await upsertAgentDefinition('implementation', mockDefinition);

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ isBuiltin: false }),
			);
		});

		it('throws when definition fails Zod validation', async () => {
			const invalid = { bad: 'data' } as unknown as AgentDefinition;

			await expect(upsertAgentDefinition('test', invalid)).rejects.toThrow();
		});
	});

	describe('deleteAgentDefinition', () => {
		it('deletes by agentType', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteAgentDefinition('implementation');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});
