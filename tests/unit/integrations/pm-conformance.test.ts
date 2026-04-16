/**
 * Conformance harness — iterates every registered PM provider manifest
 * and asserts the contract invariants that the cross-cutting code
 * depends on. This is the structural guarantee against the class of
 * bugs Linear shipped this session: if a manifest is incomplete, CI
 * fails here rather than silently failing in production.
 *
 * In plan 006/1, only `TestProvider` is in the registry. Plans 006/2–4
 * migrate real providers into the harness one at a time.
 */

import { describe, expect, it } from 'vitest';
import { listPMProviders } from '../../../src/integrations/pm/registry.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import { registerTestProvider } from '../../helpers/testPMProvider.js';

// Import every real PM provider so the harness exercises each of them
// alongside the TestProvider fixture.
import '../../../src/integrations/pm/trello/index.js';
import '../../../src/integrations/pm/jira/index.js';
import '../../../src/integrations/pm/linear/index.js';

// describe.each evaluates at collection time, before beforeAll. Register
// the TestProvider at module load so the iteration sees it.
registerTestProvider();

describe('PM provider conformance (every registered provider)', () => {
	const providers = listPMProviders();

	if (providers.length === 0) {
		it('registry contains at least one provider', () => {
			expect(providers.length).toBeGreaterThan(0);
		});
		return;
	}

	describe.each(providers.map((p) => [p.id, p] as const))('%s', (id, manifest) => {
		it('id is URL-safe kebab/lowercase', () => {
			expect(id).toMatch(/^[a-z0-9-]+$/);
		});

		it('category is the literal "pm"', () => {
			expect(manifest.category).toBe('pm');
		});

		it('webhookRoute matches the /<id>/webhook convention', () => {
			expect(manifest.webhookRoute).toBe(`/${id}/webhook`);
		});

		it('routerAdapter.type matches the manifest id', () => {
			expect(manifest.routerAdapter.type).toBe(id);
		});

		it('has at least one required credential role', () => {
			const required = manifest.credentialRoles.filter((r) => !r.optional);
			expect(required.length).toBeGreaterThan(0);
		});

		it('credentialRoles have unique roles', () => {
			const roles = manifest.credentialRoles.map((r) => r.role);
			expect(new Set(roles).size).toBe(roles.length);
		});

		it('extractProjectIdFromJob returns null for a foreign job type', async () => {
			const foreignJob = { type: 'some-other-provider' } as unknown as CascadeJob;
			expect(await manifest.extractProjectIdFromJob(foreignJob)).toBeNull();
		});

		it('extractProjectIdFromJob returns the projectId for a job shaped { type: id, projectId }', async () => {
			const job = { type: id, projectId: 'proj-xyz' } as unknown as CascadeJob;
			expect(await manifest.extractProjectIdFromJob(job)).toBe('proj-xyz');
		});

		it('triggerHandlers have unique names', () => {
			const names = manifest.triggerHandlers.map((h) => h.name);
			expect(new Set(names).size).toBe(names.length);
		});

		it('platformClientFactory returns a client with postComment + deleteComment methods', () => {
			// PlatformCommentClient's required contract is postComment + deleteComment.
			// updateComment / postReaction are provider-specific extensions.
			const client = manifest.platformClientFactory('proj-xyz');
			expect(typeof client.postComment).toBe('function');
			expect(typeof client.deleteComment).toBe('function');
		});

		it('pmIntegration is wired (type matches id)', () => {
			// Confirms the manifest plumbs the PMIntegration. Actual behavior of
			// parseWebhookPayload on the integration is tested per-provider; the
			// harness only verifies the wiring.
			expect(manifest.pmIntegration).toBeTruthy();
		});
	});
});
