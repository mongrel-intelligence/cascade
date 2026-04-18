/**
 * Asserts the plan 009/5 scope: legacy per-provider `verify*`
 * discovery procedures have been deleted from the integrations-discovery
 * router in favour of the generic `pm.discover` endpoint. The
 * `create*Label` / `create*CustomField` procedures remain (TODO —
 * follow-up spec) because they're mutations without a current generic
 * `pm.create*` equivalent.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/api/trpc.js', async () => {
	const { initTRPC } = await import('@trpc/server');
	const t = initTRPC.context<{ effectiveOrgId: string }>().create();
	return { router: t.router, protectedProcedure: t.procedure, t };
});

import { integrationsDiscoveryRouter } from '../../../src/api/routers/integrationsDiscovery.js';

describe('integrationsDiscoveryRouter — plan 009/5 legacy cleanup', () => {
	it('verifyTrello is removed', () => {
		expect(
			(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>).verifyTrello,
		).toBeUndefined();
	});

	it('verifyJira is removed', () => {
		expect(
			(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>).verifyJira,
		).toBeUndefined();
	});

	it('verifyLinear is removed', () => {
		expect(
			(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>).verifyLinear,
		).toBeUndefined();
	});

	/**
	 * Spec 010/1 flipped the mutation procedures from "deferred" to
	 * "removed". Callers migrated to `pm.discovery.createLabel` /
	 * `pm.discovery.createCustomField`.
	 */
	describe('spec 010/1 cleanup (mutation procedures removed)', () => {
		it.each([
			'createTrelloLabel',
			'createTrelloLabels',
			'createTrelloCustomField',
			'createJiraCustomField',
			'createLinearLabel',
			'createLinearLabels',
		])('%s is removed (migrated to pm.discovery.create*)', (name) => {
			expect(
				(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>)[name],
			).toBeUndefined();
		});
	});

	it('verifyGithubToken stays (SCM is out of spec 009 scope)', () => {
		expect(
			(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>).verifyGithubToken,
		).toBeDefined();
	});

	it('verifySentry stays (alerting is out of spec 009 scope)', () => {
		expect(
			(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>).verifySentry,
		).toBeDefined();
	});
});
