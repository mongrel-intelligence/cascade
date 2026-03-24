import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntegrationRegistry } from '../../../src/integrations/registry.js';
import type { IntegrationModule } from '../../../src/integrations/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModule(
	type: string,
	category: 'pm' | 'scm' | 'alerting',
	hasIntegrationResult = false,
): IntegrationModule {
	return {
		type,
		category,
		withCredentials: vi.fn((_projectId, fn) => fn()),
		hasIntegration: vi.fn().mockResolvedValue(hasIntegrationResult),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationRegistry', () => {
	let registry: IntegrationRegistry;

	beforeEach(() => {
		registry = new IntegrationRegistry();
	});

	// =========================================================================
	// register
	// =========================================================================
	describe('register', () => {
		it('registers an integration without error', () => {
			const module = makeModule('trello', 'pm');
			expect(() => registry.register(module)).not.toThrow();
		});

		it('throws on duplicate registration for the same type', () => {
			const module = makeModule('trello', 'pm');
			registry.register(module);
			expect(() => registry.register(module)).toThrow(
				"Integration type 'trello' is already registered",
			);
		});

		it('allows registering multiple integrations of different types', () => {
			registry.register(makeModule('trello', 'pm'));
			registry.register(makeModule('github', 'scm'));
			registry.register(makeModule('sentry', 'alerting'));
			expect(registry.all()).toHaveLength(3);
		});
	});

	// =========================================================================
	// get
	// =========================================================================
	describe('get', () => {
		it('returns the registered integration by type', () => {
			const module = makeModule('trello', 'pm');
			registry.register(module);
			expect(registry.get('trello')).toBe(module);
		});

		it('throws for an unknown provider type', () => {
			expect(() => registry.get('unknown-provider')).toThrow(
				"Unknown integration type: 'unknown-provider'",
			);
		});

		it('error message includes registered types', () => {
			registry.register(makeModule('trello', 'pm'));
			registry.register(makeModule('github', 'scm'));
			expect(() => registry.get('sentry')).toThrow(/Registered: trello, github/);
		});
	});

	// =========================================================================
	// getOrNull
	// =========================================================================
	describe('getOrNull', () => {
		it('returns the integration when found', () => {
			const module = makeModule('github', 'scm');
			registry.register(module);
			expect(registry.getOrNull('github')).toBe(module);
		});

		it('returns null for an unregistered type', () => {
			expect(registry.getOrNull('not-registered')).toBeNull();
		});
	});

	// =========================================================================
	// getByCategory
	// =========================================================================
	describe('getByCategory', () => {
		beforeEach(() => {
			registry.register(makeModule('trello', 'pm'));
			registry.register(makeModule('jira', 'pm'));
			registry.register(makeModule('github', 'scm'));
			registry.register(makeModule('sentry', 'alerting'));
		});

		it('returns all PM integrations', () => {
			const pmIntegrations = registry.getByCategory('pm');
			expect(pmIntegrations).toHaveLength(2);
			expect(pmIntegrations.map((i) => i.type)).toEqual(expect.arrayContaining(['trello', 'jira']));
		});

		it('returns all SCM integrations', () => {
			const scmIntegrations = registry.getByCategory('scm');
			expect(scmIntegrations).toHaveLength(1);
			expect(scmIntegrations[0].type).toBe('github');
		});

		it('returns all alerting integrations', () => {
			const alertingIntegrations = registry.getByCategory('alerting');
			expect(alertingIntegrations).toHaveLength(1);
			expect(alertingIntegrations[0].type).toBe('sentry');
		});

		it('returns empty array when no integrations match the category', () => {
			const emptyRegistry = new IntegrationRegistry();
			expect(emptyRegistry.getByCategory('pm')).toEqual([]);
		});
	});

	// =========================================================================
	// all
	// =========================================================================
	describe('all', () => {
		it('returns empty array when no integrations are registered', () => {
			expect(registry.all()).toEqual([]);
		});

		it('returns all registered integrations', () => {
			const trello = makeModule('trello', 'pm');
			const github = makeModule('github', 'scm');
			registry.register(trello);
			registry.register(github);

			const all = registry.all();
			expect(all).toHaveLength(2);
			expect(all).toEqual(expect.arrayContaining([trello, github]));
		});
	});

	// =========================================================================
	// hasIntegration
	// =========================================================================
	describe('hasIntegration', () => {
		it('returns false when the integration type is not registered', async () => {
			const result = await registry.hasIntegration('unknown', 'proj-1');
			expect(result).toBe(false);
		});

		it('delegates to the module hasIntegration() when integration is registered and returns true', async () => {
			const module = makeModule('trello', 'pm', true);
			registry.register(module);

			const result = await registry.hasIntegration('trello', 'proj-1');
			expect(result).toBe(true);
			expect(module.hasIntegration).toHaveBeenCalledWith('proj-1');
		});

		it('delegates to the module hasIntegration() when integration is registered and returns false', async () => {
			const module = makeModule('github', 'scm', false);
			registry.register(module);

			const result = await registry.hasIntegration('github', 'proj-2');
			expect(result).toBe(false);
			expect(module.hasIntegration).toHaveBeenCalledWith('proj-2');
		});

		it('passes the correct projectId to the module', async () => {
			const module = makeModule('sentry', 'alerting', true);
			registry.register(module);

			await registry.hasIntegration('sentry', 'my-project-id');

			expect(module.hasIntegration).toHaveBeenCalledWith('my-project-id');
		});
	});
});
