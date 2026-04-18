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

	/**
	 * Spec 010/2 migrated the 1:1-mappable read procedures to
	 * `pm.discovery.discover`. The composite `*Details(ByProject)` procedures
	 * stay (deferred to a follow-up because they bundle multiple reads
	 * including some capabilities that aren't yet exposed).
	 */
	describe('spec 010/2 cleanup (read procedures removed)', () => {
		it.each([
			'trelloBoards',
			'trelloBoardsByProject',
			'jiraProjects',
			'jiraProjectsByProject',
			'linearTeams',
			'linearTeamsByProject',
			'linearProjects',
			'linearProjectsByProject',
		])('%s is removed (migrated to pm.discovery.discover)', (name) => {
			expect(
				(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>)[name],
			).toBeUndefined();
		});
	});

	describe('spec 010/2 deferred (composite *Details procedures remain)', () => {
		it.each([
			'trelloBoardDetails',
			'trelloBoardDetailsByProject',
			'jiraProjectDetails',
			'jiraProjectDetailsByProject',
			'linearTeamDetails',
			'linearTeamDetailsByProject',
		])('%s is still defined (composite reads — pending follow-up)', (name) => {
			expect(
				(integrationsDiscoveryRouter._def.procedures as Record<string, unknown>)[name],
			).toBeDefined();
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
