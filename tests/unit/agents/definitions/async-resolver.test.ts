import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearDefinitionCache,
	invalidateDefinitionCache,
	loadAgentDefinition,
	resolveAgentDefinition,
	resolveAllAgentDefinitions,
	resolveKnownAgentTypes,
} from '../../../../src/agents/definitions/loader.js';

const ALL_AGENT_TYPES = [
	'debug',
	'email-joke',
	'implementation',
	'planning',
	'respond-to-ci',
	'respond-to-planning-comment',
	'respond-to-pr-comment',
	'respond-to-review',
	'review',
	'splitting',
];

// We mock the DB repository so these tests don't require a real DB connection.
vi.mock('../../../../src/db/repositories/agentDefinitionsRepository.js', () => ({
	getAgentDefinition: vi.fn(),
	listAgentDefinitions: vi.fn(),
	upsertAgentDefinition: vi.fn(),
	deleteAgentDefinition: vi.fn(),
}));

async function getDbMocks() {
	const mod = await import('../../../../src/db/repositories/agentDefinitionsRepository.js');
	return {
		getAgentDefinition: vi.mocked(mod.getAgentDefinition),
		listAgentDefinitions: vi.mocked(mod.listAgentDefinitions),
	};
}

describe('resolveAgentDefinition', () => {
	beforeEach(() => {
		clearDefinitionCache();
	});

	afterEach(() => {
		clearDefinitionCache();
		vi.clearAllMocks();
	});

	it('returns from in-memory cache when already loaded', async () => {
		// Prime the cache via the sync loader
		const fromYaml = loadAgentDefinition('implementation');
		const { getAgentDefinition } = await getDbMocks();

		// resolveAgentDefinition should return the cached value without hitting DB
		const result = await resolveAgentDefinition('implementation');
		expect(result).toBe(fromYaml);
		expect(getAgentDefinition).not.toHaveBeenCalled();
	});

	it('fetches from DB when cache is empty and DB has the definition', async () => {
		const { getAgentDefinition } = await getDbMocks();
		const dbDef = loadAgentDefinition('planning');
		clearDefinitionCache();

		getAgentDefinition.mockResolvedValue(dbDef);

		const result = await resolveAgentDefinition('planning');
		expect(result).toEqual(dbDef);
		expect(getAgentDefinition).toHaveBeenCalledWith('planning');
	});

	it('falls back to YAML when DB returns null', async () => {
		const { getAgentDefinition } = await getDbMocks();
		getAgentDefinition.mockResolvedValue(null);

		const result = await resolveAgentDefinition('splitting');
		const expected = loadAgentDefinition('splitting');
		expect(result).toEqual(expected);
	});

	it('falls back to YAML when DB throws', async () => {
		const { getAgentDefinition } = await getDbMocks();
		getAgentDefinition.mockRejectedValue(new Error('DB connection failed'));

		const result = await resolveAgentDefinition('review');
		const expected = loadAgentDefinition('review');
		expect(result).toEqual(expected);
	});

	it('caches DB result so subsequent calls skip DB', async () => {
		const { getAgentDefinition } = await getDbMocks();
		const dbDef = loadAgentDefinition('debug');
		clearDefinitionCache();
		getAgentDefinition.mockResolvedValue(dbDef);

		await resolveAgentDefinition('debug');
		await resolveAgentDefinition('debug');

		// DB should only be called once; second call uses cache
		expect(getAgentDefinition).toHaveBeenCalledTimes(1);
	});
});

describe('resolveAllAgentDefinitions', () => {
	beforeEach(() => {
		clearDefinitionCache();
	});

	afterEach(() => {
		clearDefinitionCache();
		vi.clearAllMocks();
	});

	it('returns map with all YAML types when DB returns empty list', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		listAgentDefinitions.mockResolvedValue([]);

		const result = await resolveAllAgentDefinitions();
		expect(result.size).toBe(10);
		for (const agentType of ALL_AGENT_TYPES) {
			expect(result.has(agentType)).toBe(true);
		}
	});

	it('prefers DB definitions over YAML when present in DB', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		const dbDef = loadAgentDefinition('implementation');
		clearDefinitionCache();

		// Simulate DB having only "implementation"
		listAgentDefinitions.mockResolvedValue([
			{ agentType: 'implementation', definition: dbDef, isBuiltin: true },
		]);

		const result = await resolveAllAgentDefinitions();
		expect(result.size).toBe(10); // still has all 10 (rest from YAML)
		expect(result.get('implementation')).toEqual(dbDef);
	});

	it('returns full YAML set when DB throws', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		listAgentDefinitions.mockRejectedValue(new Error('DB offline'));

		const result = await resolveAllAgentDefinitions();
		expect(result.size).toBe(10);
		for (const agentType of ALL_AGENT_TYPES) {
			expect(result.has(agentType)).toBe(true);
		}
	});
});

describe('resolveKnownAgentTypes', () => {
	beforeEach(() => {
		clearDefinitionCache();
	});

	afterEach(() => {
		clearDefinitionCache();
		vi.clearAllMocks();
	});

	it('returns all 10 YAML types when DB returns empty list', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		listAgentDefinitions.mockResolvedValue([]);

		const types = await resolveKnownAgentTypes();
		expect(types).toEqual(ALL_AGENT_TYPES);
	});

	it('merges DB-only types with YAML types', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		const customDef = loadAgentDefinition('implementation');
		clearDefinitionCache();

		listAgentDefinitions.mockResolvedValue([
			{ agentType: 'custom-agent', definition: customDef, isBuiltin: false },
		]);

		const types = await resolveKnownAgentTypes();
		expect(types).toContain('custom-agent');
		// Also includes all standard YAML types
		for (const t of ALL_AGENT_TYPES) {
			expect(types).toContain(t);
		}
		// Should be sorted
		expect(types).toEqual([...types].sort());
	});

	it('returns YAML types only when DB throws', async () => {
		const { listAgentDefinitions } = await getDbMocks();
		listAgentDefinitions.mockRejectedValue(new Error('DB offline'));

		const types = await resolveKnownAgentTypes();
		expect(types).toEqual(ALL_AGENT_TYPES);
	});
});

describe('invalidateDefinitionCache', () => {
	beforeEach(() => {
		clearDefinitionCache();
	});

	afterEach(() => {
		clearDefinitionCache();
		vi.clearAllMocks();
	});

	it('clears the in-memory cache so next resolve hits DB', async () => {
		const { getAgentDefinition } = await getDbMocks();
		const dbDef = loadAgentDefinition('planning');
		// Clear cache after priming via loadAgentDefinition so resolveAgentDefinition hits DB
		clearDefinitionCache();
		getAgentDefinition.mockResolvedValue(dbDef);

		// Prime the cache via the async resolver (which hits DB first call)
		await resolveAgentDefinition('planning');
		expect(getAgentDefinition).toHaveBeenCalledTimes(1);

		// After invalidation the cache is clear, so the next call hits DB again
		invalidateDefinitionCache();
		await resolveAgentDefinition('planning');
		expect(getAgentDefinition).toHaveBeenCalledTimes(2);
	});

	it('behaves identically to clearDefinitionCache for the sync path', () => {
		loadAgentDefinition('splitting'); // prime cache
		invalidateDefinitionCache();
		// Sync load still works (reads fresh from YAML)
		expect(() => loadAgentDefinition('splitting')).not.toThrow();
	});
});

describe('seed script idempotency (unit)', () => {
	it('calling seedAgentDefinitions twice does not throw', async () => {
		const { upsertAgentDefinition } = await import(
			'../../../../src/db/repositories/agentDefinitionsRepository.js'
		);
		vi.mocked(upsertAgentDefinition).mockResolvedValue(undefined);

		const { seedAgentDefinitions } = await import(
			'../../../../src/db/seeds/seedAgentDefinitions.js'
		);

		await expect(seedAgentDefinitions()).resolves.not.toThrow();
		await expect(seedAgentDefinitions()).resolves.not.toThrow();

		// Should have been called 10 types × 2 runs = 20 times
		expect(vi.mocked(upsertAgentDefinition)).toHaveBeenCalledTimes(20);
	});
});
