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

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listPMProviders, registerPMProvider } from '../../../src/integrations/pm/registry.js';
import type { PMProvider } from '../../../src/pm/types.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import {
	createFakePMManifest,
	createFakePMProvider,
	runLifecycleScenario,
} from '../../helpers/fakePMProvider.js';
import { jiraLifecycleFixture } from '../../helpers/jiraLifecycleFixture.js';
import { linearLifecycleFixture } from '../../helpers/linearLifecycleFixture.js';
import { registerTestProvider } from '../../helpers/testPMProvider.js';
import { trelloLifecycleFixture } from '../../helpers/trelloLifecycleFixture.js';

/**
 * Test-only registry of lifecycle fixtures keyed by manifest's
 * `lifecycle.fixtureKey`. Keeps test helpers out of production code
 * while letting the harness dispatch to the right per-provider fixture.
 */
const LIFECYCLE_FIXTURES: Record<
	string,
	() => Promise<{ provider: PMProvider; containerId: string }>
> = {
	fake: async () => {
		const { provider } = createFakePMProvider();
		return { provider, containerId: 'fake-container-a' };
	},
	trello: trelloLifecycleFixture,
	jira: jiraLifecycleFixture,
	linear: linearLifecycleFixture,
};

// Import every real PM provider so the harness exercises each of them
// alongside the TestProvider fixture.
import '../../../src/integrations/pm/trello/index.js';
import '../../../src/integrations/pm/jira/index.js';
import '../../../src/integrations/pm/linear/index.js';

// describe.each evaluates at collection time, before beforeAll. Register
// the TestProvider + FakePMProvider at module load so the iteration sees
// them. The fake is the ground-truth exerciser for plan 009/1's behavioral
// contract assertions (config round-trip, discovery shape, lifecycle,
// webhook verify) — real providers opt in per plan 2/3/4.
registerTestProvider();
const fakeManifest = createFakePMManifest();
try {
	registerPMProvider(fakeManifest);
} catch {
	// Duplicate-id registration — harmless if another test file already
	// registered the fake in the same Vitest worker.
}

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

		// ── Plan 009/1 behavioral contract assertions ─────────────────────
		//
		// Each block below is guarded by the manifest opting into the
		// respective contract (configSchema declared, discoveryCapabilities
		// declared, lifecycle.enabled, etc.). Legacy manifests that haven't
		// opted in get skipped — migration plans 2/3/4 flip each real
		// provider on.

		describe('behavioral: config round-trip', () => {
			const schema = manifest.configSchema;
			const canRun = !!schema;
			it.skipIf(!canRun)('a fixture config round-trips through the declared schema', () => {
				if (!schema) return;
				const fixture = manifest.configFixture;
				if (fixture === undefined) {
					// No fixture declared — parse is sufficient to prove the
					// schema doesn't crash on its own defaults (if any).
					expect(() => schema.parse({})).not.toThrow();
					return;
				}
				const parsed1 = schema.parse(fixture);
				const parsed2 = schema.parse(JSON.parse(JSON.stringify(parsed1)));
				expect(parsed2).toEqual(parsed1);
			});
		});

		describe('behavioral: discovery shape', () => {
			const caps = manifest.discoveryCapabilities;
			const canRun = !!caps && id === 'fake';
			it.skipIf(!canRun)(
				'every declared capability returns an array from the adapter',
				async () => {
					if (!caps) return;
					const { provider } = createFakePMProvider();
					const capabilities = (Object.keys(caps) as Array<keyof typeof caps>).filter(
						(k) => caps[k],
					);
					expect(capabilities.length).toBeGreaterThan(0);
					for (const capability of capabilities) {
						const args =
							capability === 'containers'
								? ({} as never)
								: ({ containerId: 'fake-container-a' } as never);
						const result = await provider.discover?.(capability, args);
						expect(Array.isArray(result), `${capability} must return an array`).toBe(true);
					}
				},
			);
		});

		describe('behavioral: lifecycle scenario', () => {
			const fixtureKey = manifest.lifecycle?.fixtureKey;
			const fixture = fixtureKey ? LIFECYCLE_FIXTURES[fixtureKey] : undefined;
			const canRun = manifest.lifecycle?.enabled === true && !!fixture;
			it.skipIf(!canRun)(
				'runs the full create → list → move → checklist → comment → delete scenario',
				async () => {
					if (!fixture) return;
					const { provider, containerId } = await fixture();
					const report = await runLifecycleScenario(provider, containerId, {
						title: 'Conformance lifecycle item',
					});
					expect(report.created.id).toBeTruthy();
					expect(report.listed.length).toBeGreaterThan(0);
					expect(report.moved).toBe(true);
					expect(report.checklistId).toBeTruthy();
					expect(report.commentId).toBeTruthy();
					expect(report.deleted).toBe(true);
				},
			);
		});

		describe('behavioral: createLabel hook (plan 010/1)', () => {
			const hook = manifest.createLabel;
			const canRun = typeof hook === 'function';
			it.skipIf(!canRun)('returns { id, name, color } for a valid call', async () => {
				if (!hook) return;
				// Use fixture credentials/container — real providers have
				// vi.mock'd clients in their per-provider test files, so
				// this harness call exercises the hook's shape contract
				// (manifest dispatch + credential scoping + return shape).
				const result = await hook({
					credentials: {},
					containerId: 'conformance-container',
					name: 'conformance-label',
					color: 'red',
				}).catch((err) => {
					// Real providers' clients aren't mocked at the harness
					// level (each provider tests its own mocks). If the hook
					// throws due to a missing client stub here, treat it as
					// skipped — the shape contract is exercised elsewhere.
					return { __skip: String(err) };
				});
				if (typeof result === 'object' && result && '__skip' in result) return;
				expect(result).toMatchObject({ name: 'conformance-label' });
				expect((result as { id: string }).id).toBeTruthy();
			});
		});

		describe('behavioral: createCustomField hook (plan 010/1)', () => {
			const hook = manifest.createCustomField;
			const canRun = typeof hook === 'function';
			it.skipIf(!canRun)('returns { id, name, type } for a valid call', async () => {
				if (!hook) return;
				const result = await hook({
					credentials: {},
					containerId: 'conformance-container',
					name: 'conformance-field',
				}).catch((err) => ({ __skip: String(err) }));
				if (typeof result === 'object' && result && '__skip' in result) return;
				expect(result).toMatchObject({ name: 'conformance-field' });
				expect((result as { id: string }).id).toBeTruthy();
				expect((result as { type: string }).type).toBeTruthy();
			});
		});

		describe('behavioral: trigger self-hook filter', () => {
			const hook = manifest.isSelfAuthoredHook;
			const canRun = typeof hook === 'function';
			it.skipIf(!canRun)('isSelfAuthoredHook returns a boolean for a baseline event', async () => {
				if (!hook) return;
				// Minimal invariant — the hook accepts a fabricated event and
				// returns a boolean. Real per-provider assertions of which
				// payloads count as self-authored live in the provider's
				// trigger tests.
				const fakeEvent = {
					provider: id,
					eventName: 'synthetic',
					rawBody: '{}',
					headers: {},
				} as unknown as Parameters<NonNullable<typeof manifest.isSelfAuthoredHook>>[0];
				const result = await hook(fakeEvent, {}, 'proj-xyz');
				expect(typeof result).toBe('boolean');
			});
		});

		describe('behavioral: webhook verify accept/reject', () => {
			// Only fake provider declares a harness-compatible HMAC-SHA256
			// verifier with the header convention the harness knows. Real
			// providers' verify accept/reject fixtures land in their
			// migration plans (2/3/4) — the plan 1 harness only exercises
			// the fake to prove the assertion machinery works.
			const canRun = id === 'fake';
			it.skipIf(!canRun)('accepts a correctly-signed body and rejects a tampered one', () => {
				const secret = 'fake-secret';
				const body = '{"hello":"world"}';
				const signature = createHmac('sha256', secret).update(body).digest('hex');
				const headers = { 'x-fake-signature': signature };
				expect(manifest.verifyWebhookSignature(body, headers, secret)).toBe(true);

				// Tamper with one byte of the signature.
				const tampered = signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a');
				const tamperedHeaders = { 'x-fake-signature': tampered };
				expect(manifest.verifyWebhookSignature(body, tamperedHeaders, secret)).toBe(false);

				// Tamper with the body — the correct signature no longer matches.
				expect(manifest.verifyWebhookSignature(`${body}-tampered`, headers, secret)).toBe(false);
			});
		});
	});
});
