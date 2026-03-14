import { describe, expect, it } from 'vitest';

import { CONTEXT_STEP_REGISTRY } from '../../../../src/agents/definitions/strategies.js';

describe.concurrent('CONTEXT_STEP_REGISTRY', () => {
	it('contains all expected step names', () => {
		const expectedKeys = [
			'directoryListing',
			'contextFiles',
			'squint',
			'workItem',
			'prepopulateTodos',
			'prContext',
			'prConversation',
			'pipelineSnapshot',
		];

		for (const key of expectedKeys) {
			expect(CONTEXT_STEP_REGISTRY).toHaveProperty(key);
		}
	});

	it('each registry entry is a function', () => {
		for (const [key, value] of Object.entries(CONTEXT_STEP_REGISTRY)) {
			expect(typeof value, `CONTEXT_STEP_REGISTRY["${key}"] should be a function`).toBe('function');
		}
	});

	it('contains no unexpected entries (exact key list)', () => {
		const expectedKeys = [
			'directoryListing',
			'contextFiles',
			'squint',
			'workItem',
			'prepopulateTodos',
			'prContext',
			'prConversation',
			'pipelineSnapshot',
		];

		const actualKeys = Object.keys(CONTEXT_STEP_REGISTRY);
		expect(actualKeys.sort()).toEqual(expectedKeys.sort());
	});

	it('directoryListing entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.directoryListing).toBe('function');
	});

	it('contextFiles entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.contextFiles).toBe('function');
	});

	it('squint entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.squint).toBe('function');
	});

	it('workItem entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.workItem).toBe('function');
	});

	it('prContext entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.prContext).toBe('function');
	});

	it('prConversation entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.prConversation).toBe('function');
	});

	it('pipelineSnapshot entry is a function', () => {
		expect(typeof CONTEXT_STEP_REGISTRY.pipelineSnapshot).toBe('function');
	});
});
