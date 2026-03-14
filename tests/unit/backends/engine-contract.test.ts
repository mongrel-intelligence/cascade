import { beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltInEngines } from '../../../src/backends/bootstrap.js';
import {
	getEngine,
	getEngineCatalog,
	getRegisteredEngines,
} from '../../../src/backends/registry.js';

const EXPECTED_ENGINE_IDS = ['llmist', 'claude-code', 'codex', 'opencode'] as const;
const KNOWN_AGENT_TYPES = ['implementation', 'review', 'splitting'] as const;

beforeAll(() => {
	registerBuiltInEngines();
});

describe('registerBuiltInEngines', () => {
	it('registers all 4 built-in engines', () => {
		const registeredIds = getRegisteredEngines();
		for (const id of EXPECTED_ENGINE_IDS) {
			expect(registeredIds, `Expected engine "${id}" to be registered`).toContain(id);
		}
	});

	it('registers exactly the expected engines', () => {
		const registeredIds = getRegisteredEngines();
		for (const id of EXPECTED_ENGINE_IDS) {
			expect(registeredIds).toContain(id);
		}
	});
});

describe.each(EXPECTED_ENGINE_IDS)('engine: %s', (engineId) => {
	it('is retrievable from the registry', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
	});

	it('has a definition with required fields', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		const { definition } = engine;

		expect(typeof definition.id).toBe('string');
		expect(definition.id.length).toBeGreaterThan(0);

		expect(typeof definition.label).toBe('string');
		expect(definition.label.length).toBeGreaterThan(0);

		expect(typeof definition.description).toBe('string');
		expect(definition.description.length).toBeGreaterThan(0);

		expect(Array.isArray(definition.capabilities)).toBe(true);

		expect(definition.modelSelection).toBeDefined();
		expect(['free-text', 'select']).toContain(definition.modelSelection.type);

		expect(typeof definition.logLabel).toBe('string');
		expect(definition.logLabel.length).toBeGreaterThan(0);
	});

	it("definition.id matches the engine's registry key", () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		expect(engine.definition.id).toBe(engineId);
	});

	it('has execute as a function', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		expect(typeof engine.execute).toBe('function');
	});

	it('has supportsAgentType as a function', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		expect(typeof engine.supportsAgentType).toBe('function');
	});

	it.each(KNOWN_AGENT_TYPES)('supportsAgentType("%s") returns a boolean', (agentType) => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		const result = engine.supportsAgentType(agentType);
		expect(typeof result).toBe('boolean');
	});

	it('optional resolveModel is a function if present', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		if (engine.resolveModel !== undefined) {
			expect(typeof engine.resolveModel).toBe('function');
		}
	});

	it('optional beforeExecute is a function if present', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		if (engine.beforeExecute !== undefined) {
			expect(typeof engine.beforeExecute).toBe('function');
		}
	});

	it('optional afterExecute is a function if present', () => {
		const engine = getEngine(engineId);
		expect(engine).toBeDefined();
		if (!engine) return;
		if (engine.afterExecute !== undefined) {
			expect(typeof engine.afterExecute).toBe('function');
		}
	});
});

describe('getEngineCatalog', () => {
	it('returns definitions for all registered engines', () => {
		const catalog = getEngineCatalog();
		const catalogIds = catalog.map((def) => def.id);

		for (const id of EXPECTED_ENGINE_IDS) {
			expect(catalogIds, `Expected catalog to include engine "${id}"`).toContain(id);
		}
	});

	it('returns the same definition objects as the registry', () => {
		const catalog = getEngineCatalog();

		for (const def of catalog) {
			const engine = getEngine(def.id);
			expect(engine).toBeDefined();
			if (!engine) continue;
			expect(engine.definition).toBe(def);
		}
	});

	it('each catalog entry has the required fields', () => {
		const catalog = getEngineCatalog();

		for (const def of catalog) {
			expect(typeof def.id).toBe('string');
			expect(typeof def.label).toBe('string');
			expect(typeof def.description).toBe('string');
			expect(Array.isArray(def.capabilities)).toBe(true);
			expect(def.modelSelection).toBeDefined();
			expect(typeof def.logLabel).toBe('string');
		}
	});
});
