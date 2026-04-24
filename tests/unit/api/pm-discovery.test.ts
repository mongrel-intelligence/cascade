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

// Mock the DB-bound helpers used by the projectId-credential-resolution path
// so tests can exercise that branch without a live database.
vi.mock('../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: vi.fn(),
}));
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: vi.fn(),
}));
vi.mock('../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: vi.fn(async () => {}),
}));

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

		// Regression for `fix/web-build-tsc-errors` (2026-04-18): the Zod
		// enum at `DISCOVERY_CAPABILITIES` was missing 'currentUser', which
		// meant every wizard Verify-button call to the discover endpoint
		// failed input validation at runtime. This test pins that every
		// capability declared on `DiscoveryCapability` in `src/pm/types.ts`
		// is also accepted by the tRPC input schema.
		it('accepts currentUser capability (closes Zod-enum / type-union drift)', async () => {
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			const result = await caller.discover({
				providerId: 'fake',
				capability: 'currentUser',
				args: {},
			});
			expect(result).toMatchObject({ id: expect.any(String), name: expect.any(String) });
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

	describe('discover — 401 error mapping', () => {
		// Linear returns HTTP 401 for a bad API key; the server must translate
		// that to UNAUTHORIZED (not INTERNAL_SERVER_ERROR) so the wizard can
		// show "invalid credentials" instead of a generic 500.

		async function registerThrowingProvider(errorMsg: string) {
			_resetPMProviderRegistryForTesting();
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const base = createFakePMManifest();
			registerPMProvider({
				...base,
				id: 'fake-throwing',
				discoveryCapabilities: { currentUser: true },
				createDiscoveryProvider: () => {
					const { provider } = createFakePMProvider();
					return {
						...provider,
						discover: async () => {
							throw new Error(errorMsg);
						},
					};
				},
			});
		}

		it('maps provider HTTP 401 error to UNAUTHORIZED tRPC code', async () => {
			await registerThrowingProvider('Linear API HTTP error 401: Unauthorized');
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-throwing',
					capability: 'currentUser',
					args: {},
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('UNAUTHORIZED message mentions credentials/API key', async () => {
			await registerThrowingProvider('Linear API HTTP error 401: Unauthorized');
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-throwing',
					capability: 'currentUser',
					args: {},
				}),
			).rejects.toSatisfy((err: unknown) => {
				expect((err as { message: string }).message).toMatch(/credential|API key/i);
				return true;
			});
		});

		it('maps AUTHENTICATION_ERROR string to UNAUTHORIZED', async () => {
			await registerThrowingProvider('AUTHENTICATION_ERROR: token expired');
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-throwing',
					capability: 'currentUser',
					args: {},
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('re-throws non-auth provider errors as INTERNAL_SERVER_ERROR', async () => {
			await registerThrowingProvider('Linear API HTTP error 500: Internal Server Error');
			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-throwing',
					capability: 'currentUser',
					args: {},
				}),
			).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
		});
	});

	describe('configToCredentials — projectId-path config promotion', () => {
		// Regression for the 2026-04-24 production bug: a saved JIRA integration's
		// base URL lives on `project_integrations.config.baseUrl`, not on
		// `project_credentials`. `pm.discovery.discover({ projectId })` therefore
		// constructed a JIRA client with `host: ''` → "Couldn't parse the host URL".
		// The fix is a `configToCredentials` manifest hook that promotes specific
		// integration-config fields into the credentials bag used by
		// `createDiscoveryProvider`.

		beforeEach(() => {
			_resetPMProviderRegistryForTesting();
			vi.clearAllMocks();
		});

		it('merges config-derived credentials from configToCredentials into the resolved bag', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const base = createFakePMManifest();

			let receivedCredentials: Record<string, string> | undefined;
			registerPMProvider({
				...base,
				id: 'fake-with-config-creds',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				configToCredentials: (config: unknown) => {
					const c = config as { tenantUrl?: string };
					return c.tenantUrl ? { base_url: c.tenantUrl } : {};
				},
				createDiscoveryProvider: (opts) => {
					receivedCredentials = opts?.credentials ?? {};
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			const { getIntegrationCredentialOrNull } = await import('../../../src/config/provider.js');
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'ua-store',
				category: 'pm',
				provider: 'fake-with-config-creds',
				config: { tenantUrl: 'https://example.atlassian.net' },
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);
			vi.mocked(getIntegrationCredentialOrNull).mockResolvedValue('secret-key');

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-with-config-creds',
				capability: 'currentUser',
				args: {},
				projectId: 'ua-store',
			});

			expect(receivedCredentials).toEqual({
				api_key: 'secret-key',
				base_url: 'https://example.atlassian.net',
			});
		});

		it('project_credentials values win over config-derived values on collision', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const base = createFakePMManifest();

			let receivedCredentials: Record<string, string> | undefined;
			registerPMProvider({
				...base,
				id: 'fake-collision',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				// Intentionally overlaps with credentialRoles to assert precedence.
				configToCredentials: () => ({ api_key: 'from-config' }),
				createDiscoveryProvider: (opts) => {
					receivedCredentials = opts?.credentials ?? {};
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			const { getIntegrationCredentialOrNull } = await import('../../../src/config/provider.js');
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'p',
				category: 'pm',
				provider: 'fake-collision',
				config: {},
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);
			vi.mocked(getIntegrationCredentialOrNull).mockResolvedValue('from-db');

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-collision',
				capability: 'currentUser',
				args: {},
				projectId: 'p',
			});

			expect(receivedCredentials).toEqual({ api_key: 'from-db' });
		});

		it('manifests without configToCredentials still work (legacy behavior preserved)', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const base = createFakePMManifest();

			let receivedCredentials: Record<string, string> | undefined;
			registerPMProvider({
				...base,
				id: 'fake-no-hook',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				configToCredentials: undefined,
				createDiscoveryProvider: (opts) => {
					receivedCredentials = opts?.credentials ?? {};
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			const { getIntegrationCredentialOrNull } = await import('../../../src/config/provider.js');
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'p',
				category: 'pm',
				provider: 'fake-no-hook',
				config: { tenantUrl: 'https://example.atlassian.net' },
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);
			vi.mocked(getIntegrationCredentialOrNull).mockResolvedValue('secret-key');

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-no-hook',
				capability: 'currentUser',
				args: {},
				projectId: 'p',
			});

			expect(receivedCredentials).toEqual({ api_key: 'secret-key' });
		});

		it('does not invoke configToCredentials on the explicit-credentials path', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const base = createFakePMManifest();

			const hookSpy = vi.fn(() => ({ base_url: 'should-not-appear' }));
			registerPMProvider({
				...base,
				id: 'fake-no-projectid',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				configToCredentials: hookSpy,
				createDiscoveryProvider: () => {
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-no-projectid',
				capability: 'currentUser',
				args: {},
				credentials: { api_key: 'k' },
			});

			expect(hookSpy).not.toHaveBeenCalled();
		});

		// ── Error paths introduced by the resolvePMCredentials refactor ─────
		// The projectId branch now flows through two new helpers
		// (promoteConfigCredentials + loadIntegrationAndManifest) with several
		// guard throws.  These tests pin each branch so a future refactor
		// cannot silently drop one.

		it('throws UNAUTHORIZED when projectId is set but effectiveOrgId is null', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider({ ...createFakePMManifest(), id: 'fake-auth' });

			const caller = pmDiscoveryRouter.createCaller({
				effectiveOrgId: null as unknown as string,
			});
			await expect(
				caller.discover({
					providerId: 'fake-auth',
					capability: 'currentUser',
					args: {},
					projectId: 'some-project',
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('throws NOT_FOUND when the project has no PM integration configured', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider({ ...createFakePMManifest(), id: 'fake-missing' });

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue(null);

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-missing',
					capability: 'currentUser',
					args: {},
					projectId: 'orphan-project',
				}),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringMatching(/No PM integration/i),
			});
		});

		it('throws NOT_FOUND when the saved integration is for a different provider', async () => {
			const { createFakePMManifest } = await import('../../helpers/fakePMProvider.js');
			registerPMProvider({ ...createFakePMManifest(), id: 'fake-expected' });

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'p',
				category: 'pm',
				provider: 'fake-other',
				config: {},
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await expect(
				caller.discover({
					providerId: 'fake-expected',
					capability: 'currentUser',
					args: {},
					projectId: 'p',
				}),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
				message: expect.stringMatching(/different PM provider.*fake-other/),
			});
		});

		it('treats a non-object hook return (string/null/array) as empty — resolved bag contains only project_credentials', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);

			let receivedCredentials: Record<string, string> | undefined;
			registerPMProvider({
				...createFakePMManifest(),
				id: 'fake-bad-hook-return',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				// Hook returns a non-object: must be ignored, must not crash.
				configToCredentials: () => 'not-an-object' as unknown as Record<string, string>,
				createDiscoveryProvider: (opts) => {
					receivedCredentials = opts?.credentials ?? {};
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			const { getIntegrationCredentialOrNull } = await import('../../../src/config/provider.js');
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'p',
				category: 'pm',
				provider: 'fake-bad-hook-return',
				config: {},
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);
			vi.mocked(getIntegrationCredentialOrNull).mockResolvedValue('k');

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-bad-hook-return',
				capability: 'currentUser',
				args: {},
				projectId: 'p',
			});

			expect(receivedCredentials).toEqual({ api_key: 'k' });
		});

		it('swallows hook exceptions and continues with project_credentials (logs a warn)', async () => {
			const { createFakePMManifest, createFakePMProvider } = await import(
				'../../helpers/fakePMProvider.js'
			);
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			let receivedCredentials: Record<string, string> | undefined;
			registerPMProvider({
				...createFakePMManifest(),
				id: 'fake-throwing-hook',
				credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'FAKE_API_KEY' }],
				// A broken hook MUST NOT take down discovery.
				configToCredentials: () => {
					throw new Error('hook boom');
				},
				createDiscoveryProvider: (opts) => {
					receivedCredentials = opts?.credentials ?? {};
					const { provider } = createFakePMProvider();
					return provider;
				},
			});

			const { getIntegrationByProjectAndCategory } = await import(
				'../../../src/db/repositories/integrationsRepository.js'
			);
			const { getIntegrationCredentialOrNull } = await import('../../../src/config/provider.js');
			vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
				projectId: 'p',
				category: 'pm',
				provider: 'fake-throwing-hook',
				config: {},
				triggers: {},
			} as unknown as Awaited<ReturnType<typeof getIntegrationByProjectAndCategory>>);
			vi.mocked(getIntegrationCredentialOrNull).mockResolvedValue('k');

			const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
			await caller.discover({
				providerId: 'fake-throwing-hook',
				capability: 'currentUser',
				args: {},
				projectId: 'p',
			});

			expect(receivedCredentials).toEqual({ api_key: 'k' });
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("configToCredentials threw for provider 'fake-throwing-hook'"),
				expect.any(Error),
			);
			warnSpy.mockRestore();
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
