import { beforeEach, describe, expect, it } from 'vitest';
import {
	getBackend,
	getRegisteredBackends,
	registerBackend,
} from '../../../src/backends/registry.js';
import type { AgentBackend } from '../../../src/backends/types.js';

function createMockBackend(name: string): AgentBackend {
	return {
		name,
		execute: async () => ({ success: true, output: '' }),
		supportsAgentType: () => true,
	};
}

// The registry uses module-level state (Map), so tests interact with shared state.
// We rely on unique names per test to avoid interference.

describe('registerBackend', () => {
	it('registers a backend by name', () => {
		const backend = createMockBackend('test-register');
		registerBackend(backend);
		expect(getBackend('test-register')).toBe(backend);
	});

	it('overwrites existing backend with same name', () => {
		const backend1 = createMockBackend('test-overwrite');
		const backend2 = createMockBackend('test-overwrite');
		registerBackend(backend1);
		registerBackend(backend2);
		expect(getBackend('test-overwrite')).toBe(backend2);
	});
});

describe('getBackend', () => {
	it('returns registered backend', () => {
		const backend = createMockBackend('test-get');
		registerBackend(backend);
		expect(getBackend('test-get')).toBe(backend);
	});

	it('returns undefined for unknown name', () => {
		expect(getBackend('nonexistent-backend-xyz')).toBeUndefined();
	});
});

describe('getRegisteredBackends', () => {
	it('returns all registered backend names', () => {
		registerBackend(createMockBackend('test-list-a'));
		registerBackend(createMockBackend('test-list-b'));
		const names = getRegisteredBackends();
		expect(names).toContain('test-list-a');
		expect(names).toContain('test-list-b');
	});
});
