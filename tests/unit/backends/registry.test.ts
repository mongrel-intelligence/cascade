import { beforeEach, describe, expect, it } from 'vitest';
import { getEngine, getRegisteredEngines, registerEngine } from '../../../src/backends/registry.js';
import type { AgentEngine } from '../../../src/backends/types.js';

function createMockEngine(id: string): AgentEngine {
	return {
		definition: {
			id,
			label: id,
			description: `${id} description`,
			capabilities: [],
			modelSelection: { type: 'free-text' },
			logLabel: 'Engine Log',
		},
		execute: async () => ({ success: true, output: '' }),
		supportsAgentType: () => true,
	};
}

// The registry uses module-level state (Map), so tests interact with shared state.
// We rely on unique names per test to avoid interference.

describe('registerEngine', () => {
	it('registers an engine by id', () => {
		const engine = createMockEngine('test-register');
		registerEngine(engine);
		expect(getEngine('test-register')).toBe(engine);
	});

	it('overwrites existing engine with same id', () => {
		const engine1 = createMockEngine('test-overwrite');
		const engine2 = createMockEngine('test-overwrite');
		registerEngine(engine1);
		registerEngine(engine2);
		expect(getEngine('test-overwrite')).toBe(engine2);
	});
});

describe('getEngine', () => {
	it('returns registered engine', () => {
		const engine = createMockEngine('test-get');
		registerEngine(engine);
		expect(getEngine('test-get')).toBe(engine);
	});

	it('returns undefined for unknown name', () => {
		expect(getEngine('nonexistent-engine-xyz')).toBeUndefined();
	});
});

describe('getRegisteredEngines', () => {
	it('returns all registered engine ids', () => {
		registerEngine(createMockEngine('test-list-a'));
		registerEngine(createMockEngine('test-list-b'));
		const names = getRegisteredEngines();
		expect(names).toContain('test-list-a');
		expect(names).toContain('test-list-b');
	});
});
