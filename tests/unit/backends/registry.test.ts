import { describe, expect, it } from 'vitest';
import {
	getEngine,
	getRegisteredEngines,
	isNativeToolEngine,
	isNativeToolEngineDefinition,
	registerEngine,
} from '../../../src/backends/registry.js';
import type { AgentEngine } from '../../../src/backends/types.js';

function createMockEngine(id: string, archetype: 'sdk' | 'native-tool' = 'sdk'): AgentEngine {
	return {
		definition: {
			id,
			label: id,
			description: `${id} description`,
			archetype,
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

describe('isNativeToolEngineDefinition', () => {
	it('returns true for native-tool archetype', () => {
		const engine = createMockEngine('test-native-def', 'native-tool');
		expect(isNativeToolEngineDefinition(engine.definition)).toBe(true);
	});

	it('returns false for sdk archetype', () => {
		const engine = createMockEngine('test-sdk-def', 'sdk');
		expect(isNativeToolEngineDefinition(engine.definition)).toBe(false);
	});
});

describe('isNativeToolEngine', () => {
	it('returns true for a registered native-tool engine', () => {
		registerEngine(createMockEngine('test-native-reg', 'native-tool'));
		expect(isNativeToolEngine('test-native-reg')).toBe(true);
	});

	it('returns false for a registered sdk engine', () => {
		registerEngine(createMockEngine('test-sdk-reg', 'sdk'));
		expect(isNativeToolEngine('test-sdk-reg')).toBe(false);
	});

	it('returns false for an unknown engine id', () => {
		expect(isNativeToolEngine('nonexistent-engine-abc')).toBe(false);
	});
});
