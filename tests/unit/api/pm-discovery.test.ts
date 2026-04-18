/**
 * Unit tests for the new registry-driven PM discovery router.
 *
 * The router is intentionally minimal in plan 006/1 — it exposes the
 * list of registered providers and their credential-role metadata. Plans
 * 006/2–006/4 extend it with generic `createLabel` / `createLabels`
 * endpoints as each provider migrates.
 *
 * These tests call the router's procedures through a caller so we avoid
 * mocking Hono transports.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth/db-bound modules the router transitively imports. The procedures
// we're testing here are readonly and don't touch the DB, but the router
// exports live in a module that brings in session + DB glue via trpc.ts.
vi.mock('../../../src/api/trpc.js', async () => {
	const { initTRPC } = await import('@trpc/server');
	const t = initTRPC.context<{ effectiveOrgId: string }>().create();
	return {
		router: t.router,
		protectedProcedure: t.procedure,
		t,
	};
});

import { pmDiscoveryRouter } from '../../../src/api/routers/pm-discovery.js';
import type { PMProviderManifest } from '../../../src/integrations/pm/manifest.js';
import {
	_resetPMProviderRegistryForTesting,
	registerPMProvider,
} from '../../../src/integrations/pm/registry.js';

function makeStub(id: string, label: string): PMProviderManifest {
	return {
		id,
		label,
		category: 'pm',
		credentialRoles: [
			{ role: 'api_key', label: 'API Key', envVarKey: `${id.toUpperCase()}_API_KEY` },
			{
				role: 'webhook_secret',
				label: 'Webhook Secret',
				envVarKey: `${id.toUpperCase()}_WEBHOOK_SECRET`,
				optional: true,
			},
		],
		webhookRoute: `/${id}/webhook`,
		verifyWebhookSignature: () => true,
		routerAdapter: { type: id } as unknown as PMProviderManifest['routerAdapter'],
		extractProjectIdFromJob: async () => null,
		pmIntegration: {} as unknown as PMProviderManifest['pmIntegration'],
		triggerHandlers: [],
		platformClientFactory: () =>
			({}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,
	};
}

describe('pmDiscoveryRouter', () => {
	beforeEach(() => {
		_resetPMProviderRegistryForTesting();
	});

	it('listProviders returns registered providers with id, label, and credential roles', async () => {
		registerPMProvider(makeStub('alpha', 'Alpha'));
		registerPMProvider(makeStub('beta', 'Beta'));

		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		const result = await caller.listProviders();

		expect(result).toEqual([
			{
				id: 'alpha',
				label: 'Alpha',
				credentialRoles: [
					{ role: 'api_key', label: 'API Key', envVarKey: 'ALPHA_API_KEY' },
					{
						role: 'webhook_secret',
						label: 'Webhook Secret',
						envVarKey: 'ALPHA_WEBHOOK_SECRET',
						optional: true,
					},
				],
			},
			{
				id: 'beta',
				label: 'Beta',
				credentialRoles: [
					{ role: 'api_key', label: 'API Key', envVarKey: 'BETA_API_KEY' },
					{
						role: 'webhook_secret',
						label: 'Webhook Secret',
						envVarKey: 'BETA_WEBHOOK_SECRET',
						optional: true,
					},
				],
			},
		]);
	});

	it('listProviders returns an empty array when the registry is empty', async () => {
		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		expect(await caller.listProviders()).toEqual([]);
	});

	it('providerCredentialRoles returns the credentialRoles for a registered provider', async () => {
		registerPMProvider(makeStub('alpha', 'Alpha'));
		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		const result = await caller.providerCredentialRoles({ providerId: 'alpha' });
		expect(result.map((r) => r.role)).toEqual(['api_key', 'webhook_secret']);
	});

	describe('discover (plan 009/1 task 10)', () => {
		beforeEach(async () => {
			_resetPMProviderRegistryForTesting();
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider(createFakePMManifest());
		});

		it('returns labels from the fake provider', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			const result = await caller.discover({
				providerId: 'fake',
				capability: 'labels',
				args: { containerId: 'fake-container-a' },
			});
			expect(Array.isArray(result)).toBe(true);
			expect((result as unknown[]).length).toBeGreaterThan(0);
		});

		it('returns states with typed category from the fake provider', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			const result = await caller.discover({
				providerId: 'fake',
				capability: 'states',
				args: { containerId: 'fake-container-a' },
			});
			expect(Array.isArray(result)).toBe(true);
			const arr = result as Array<{ category: string }>;
			for (const state of arr) {
				expect(['todo', 'in_progress', 'done', 'canceled', 'unknown']).toContain(state.category);
			}
		});

		it('throws NOT_FOUND for an unknown providerId', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'does-not-exist',
					capability: 'labels',
					args: { containerId: 'x' },
				}),
			).rejects.toThrow(/does-not-exist|NOT_FOUND|Unknown/);
		});

		it('throws UNIMPLEMENTED when the provider does not declare the capability', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			const base = createFakePMManifest();
			registerPMProvider({ ...base, id: 'fake-no-caps', discoveryCapabilities: undefined });

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-no-caps',
					capability: 'labels',
					args: { containerId: 'x' },
				}),
			).rejects.toThrow(/UNIMPLEMENTED|does not declare|capability/);
		});
	});

	describe('createLabel (plan 010/1 task 2)', () => {
		beforeEach(async () => {
			_resetPMProviderRegistryForTesting();
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider(createFakePMManifest());
		});

		it('returns { id, name, color } on success', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			const result = await caller.createLabel({
				providerId: 'fake',
				containerId: 'fake-container-a',
				name: 'bug',
				color: 'red',
				credentials: {},
			});
			expect(result).toMatchObject({ name: 'bug', color: 'red' });
			expect((result as { id: string }).id).toBeTruthy();
		});

		it('throws NOT_FOUND for an unknown providerId', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.createLabel({
					providerId: 'does-not-exist',
					containerId: 'x',
					name: 'bug',
					credentials: {},
				}),
			).rejects.toThrow(/does-not-exist|NOT_FOUND|Unknown/);
		});

		it('throws UNIMPLEMENTED when the provider does not declare createLabel', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			const base = createFakePMManifest();
			registerPMProvider({ ...base, id: 'fake-no-create', createLabel: undefined });

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.createLabel({
					providerId: 'fake-no-create',
					containerId: 'x',
					name: 'bug',
					credentials: {},
				}),
			).rejects.toThrow(/UNIMPLEMENTED|does not declare|createLabel/);
		});
	});

	describe('createCustomField (plan 010/1 task 2)', () => {
		beforeEach(async () => {
			_resetPMProviderRegistryForTesting();
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider(createFakePMManifest());
		});

		it('returns { id, name, type } on success', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			const result = await caller.createCustomField({
				providerId: 'fake',
				containerId: 'fake-container-a',
				name: 'Cost',
				credentials: {},
			});
			expect(result).toMatchObject({ name: 'Cost' });
			expect((result as { id: string }).id).toBeTruthy();
			expect((result as { type: string }).type).toBeTruthy();
		});

		it('throws NOT_FOUND for an unknown providerId', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.createCustomField({
					providerId: 'does-not-exist',
					containerId: 'x',
					name: 'Cost',
					credentials: {},
				}),
			).rejects.toThrow(/does-not-exist|NOT_FOUND|Unknown/);
		});

		it('throws UNIMPLEMENTED when the provider does not declare createCustomField', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			const base = createFakePMManifest();
			registerPMProvider({ ...base, id: 'fake-no-cf', createCustomField: undefined });

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.createCustomField({
					providerId: 'fake-no-cf',
					containerId: 'x',
					name: 'Cost',
					credentials: {},
				}),
			).rejects.toThrow(/UNIMPLEMENTED|does not declare|createCustomField/);
		});
	});
});
