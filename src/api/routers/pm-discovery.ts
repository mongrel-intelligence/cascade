/**
 * PM discovery tRPC router — registry-driven provider metadata.
 *
 * Plan 006/1 ships this minimal endpoint set: listing registered
 * providers and their credential roles. Plans 006/2–006/4 add generic
 * `createLabel` / `createLabels` procedures as each provider migrates
 * its hooks into the manifest.
 *
 * Lives alongside the legacy `integrationsDiscoveryRouter` during the
 * migration window. Plan 006/5 deletes any PM endpoints in the legacy
 * router that this one supersedes.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { getIntegrationByProjectAndCategory } from '../../db/repositories/integrationsRepository.js';
import type { PMProviderManifest } from '../../integrations/pm/manifest.js';
import { getPMProvider, listPMProviders } from '../../integrations/pm/registry.js';
import { DISCOVERY_CAPABILITIES } from '../../pm/types.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

/**
 * Invoke a manifest's optional `configToCredentials` hook and return the
 * promoted bag. Guards against malformed hook returns and swallows hook
 * errors with a warn so one broken provider cannot take down discovery
 * for everyone.
 */
function promoteConfigCredentials(
	manifest: PMProviderManifest,
	integrationConfig: unknown,
): Record<string, string> {
	if (!manifest.configToCredentials) return {};
	try {
		const promoted = manifest.configToCredentials(integrationConfig);
		return promoted && typeof promoted === 'object' ? promoted : {};
	} catch (err) {
		console.warn(`[pm-discovery] configToCredentials threw for provider '${manifest.id}':`, err);
		return {};
	}
}

/**
 * Load + validate the PM integration for a given project. Throws the
 * appropriate tRPC error when missing, misconfigured, or when the manifest
 * has been deregistered.
 */
async function loadIntegrationAndManifest(
	projectId: string,
	providerId: string,
): Promise<{ integration: { config: unknown }; manifest: PMProviderManifest }> {
	const integration = await getIntegrationByProjectAndCategory(projectId, 'pm');
	if (!integration) {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: 'No PM integration configured for this project yet',
		});
	}
	if (integration.provider !== providerId) {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: `Project is configured with a different PM provider (${integration.provider})`,
		});
	}
	const manifest = getPMProvider(providerId);
	if (!manifest) {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: `Unknown PM provider '${providerId}'`,
		});
	}
	return { integration, manifest };
}

/**
 * Shared credential resolver for pm.discovery.* endpoints. Accepts either
 * `credentials` directly or a `projectId` — if `projectId` is set, the
 * caller must have org access to the project, and we resolve each declared
 * credential role from the project_credentials table.
 *
 * On the projectId path, the manifest's optional `configToCredentials` hook
 * seeds the bag with non-secret connection fields promoted from
 * `project_integrations.config` (e.g. JIRA's cloud tenant `baseUrl`).
 * Values written from `project_credentials` override any key collisions —
 * the DB-scoped secret always wins over config-derived defaults.
 *
 * Returns a `Record<string, string>` shaped by the manifest's
 * `credentialRoles` (plus any promoted-config fields) — the shape
 * downstream hooks / `createDiscoveryProvider` factories consume.
 */
async function resolvePMCredentials(opts: {
	providerId: string;
	effectiveOrgId: string | null;
	credentials?: Record<string, string>;
	projectId?: string;
}): Promise<Record<string, string>> {
	if (!opts.projectId) return opts.credentials ?? {};

	if (!opts.effectiveOrgId) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	await verifyProjectOrgAccess(opts.projectId, opts.effectiveOrgId);

	const { integration, manifest } = await loadIntegrationAndManifest(
		opts.projectId,
		opts.providerId,
	);

	const resolved: Record<string, string> = {
		...promoteConfigCredentials(manifest, integration.config),
	};
	for (const role of manifest.credentialRoles) {
		const value = await getIntegrationCredentialOrNull(
			opts.projectId,
			'pm',
			opts.providerId,
			role.role,
		);
		if (value) resolved[role.role] = value;
	}
	return resolved;
}

const providerIdInput = z.object({
	providerId: z.string().min(1),
});

// DISCOVERY_CAPABILITIES lives in `src/pm/types.ts` — single source of
// truth; the `DiscoveryCapability` type union derives from it. The Zod
// enum here is exactly `z.enum(DISCOVERY_CAPABILITIES)` so there is no
// opportunity for the two to drift (as happened in spec 010/2 when
// `currentUser` landed in the type but not the enum).

const discoverInput = z.object({
	providerId: z.string().min(1),
	capability: z.enum(DISCOVERY_CAPABILITIES),
	args: z.record(z.string(), z.unknown()).default({}),
	credentials: z.record(z.string(), z.string()).optional(),
	projectId: z.string().optional(),
});

const createLabelInput = z.object({
	providerId: z.string().min(1),
	containerId: z.string().min(1),
	name: z.string().min(1),
	color: z.string().optional(),
	credentials: z.record(z.string(), z.string()).optional(),
	projectId: z.string().optional(),
});

const createCustomFieldInput = z.object({
	providerId: z.string().min(1),
	containerId: z.string().min(1),
	name: z.string().min(1),
	credentials: z.record(z.string(), z.string()).optional(),
	projectId: z.string().optional(),
});

export const pmDiscoveryRouter = router({
	/**
	 * List every registered PM provider with the minimal metadata the
	 * dashboard provider-select dropdown needs. Returned array order is
	 * registration order — deterministic across Node process restarts.
	 */
	listProviders: protectedProcedure.query(() =>
		listPMProviders().map((m) => ({
			id: m.id,
			label: m.label,
			credentialRoles: m.credentialRoles.map((r) => ({ ...r })),
		})),
	),

	/**
	 * Return the credential-role list for a specific provider. Throws when
	 * the provider is not registered.
	 */
	providerCredentialRoles: protectedProcedure.input(providerIdInput).query(({ input }) => {
		const manifest = getPMProvider(input.providerId);
		if (!manifest) throw new Error(`Unknown PM provider '${input.providerId}'`);
		return manifest.credentialRoles.map((r) => ({ ...r }));
	}),

	/**
	 * Generic discovery dispatch. Given a providerId + capability + args,
	 * resolve the manifest, obtain a discovery-scoped PM adapter via the
	 * manifest's `createDiscoveryProvider` factory, and call its generic
	 * `discover(capability, args)` method.
	 *
	 * This endpoint lives alongside the legacy per-provider discovery
	 * procedures during the migration window (plans 2/3/4); plan 5 deletes
	 * the legacy procedures once every provider has migrated.
	 */
	discover: protectedProcedure.input(discoverInput).mutation(async ({ ctx, input }) => {
		const manifest = getPMProvider(input.providerId);
		if (!manifest) {
			throw new TRPCError({
				code: 'NOT_FOUND',
				message: `Unknown PM provider '${input.providerId}'. Registered providers: ${listPMProviders()
					.map((m) => m.id)
					.join(', ')}`,
			});
		}

		if (!manifest.discoveryCapabilities?.[input.capability]) {
			throw new TRPCError({
				code: 'NOT_IMPLEMENTED',
				message:
					`Provider '${input.providerId}' does not declare capability '${input.capability}'. ` +
					`Declare it on manifest.discoveryCapabilities in ${input.providerId}/manifest.ts.`,
			});
		}

		if (!manifest.createDiscoveryProvider) {
			throw new TRPCError({
				code: 'NOT_IMPLEMENTED',
				message:
					`Provider '${input.providerId}' has not wired createDiscoveryProvider. ` +
					`Declare it on manifest to serve discovery.`,
			});
		}

		// Plan 010/2: resolve credentials from projectId when provided,
		// supporting the legacy `*ByProject` read-procedure use case.
		const credentials = await resolvePMCredentials({
			providerId: input.providerId,
			effectiveOrgId: ctx.effectiveOrgId,
			credentials: input.credentials,
			projectId: input.projectId,
		});

		const provider = manifest.createDiscoveryProvider({ credentials });
		if (!provider.discover) {
			throw new TRPCError({
				code: 'NOT_IMPLEMENTED',
				message: `Provider '${input.providerId}' adapter does not implement discover().`,
			});
		}

		// Call through with the raw args — the adapter is responsible for
		// any runtime narrowing (e.g. parseContainerId). Capability + args
		// typing is enforced at the adapter's method signature in plans 2/3/4.
		try {
			return await provider.discover(input.capability, input.args as never);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('HTTP error 401') || msg.includes('AUTHENTICATION_ERROR')) {
				throw new TRPCError({
					code: 'UNAUTHORIZED',
					message: 'Invalid or expired credentials. Please check your API key.',
					cause: err,
				});
			}
			throw err;
		}
	}),

	/**
	 * Generic label-creation dispatch (plan 010/1). Resolves the manifest,
	 * checks the `createLabel` hook is declared, calls it with credentials
	 * + containerId + name + color. Each provider's hook internally
	 * establishes credential scope via its own `withXxxCredentials` helper.
	 *
	 * Replaces the legacy per-provider `createTrelloLabel` /
	 * `createLinearLabel` procedures.
	 */
	createLabel: protectedProcedure.input(createLabelInput).mutation(async ({ ctx, input }) => {
		const manifest = getPMProvider(input.providerId);
		if (!manifest) {
			throw new TRPCError({
				code: 'NOT_FOUND',
				message: `Unknown PM provider '${input.providerId}'. Registered providers: ${listPMProviders()
					.map((m) => m.id)
					.join(', ')}`,
			});
		}
		if (!manifest.createLabel) {
			throw new TRPCError({
				code: 'NOT_IMPLEMENTED',
				message:
					`Provider '${input.providerId}' does not declare createLabel. ` +
					`Declare it on manifest in ${input.providerId}/manifest.ts to serve label creation.`,
			});
		}
		const credentials = await resolvePMCredentials({
			providerId: input.providerId,
			effectiveOrgId: ctx.effectiveOrgId,
			credentials: input.credentials,
			projectId: input.projectId,
		});
		return manifest.createLabel({
			credentials,
			containerId: input.containerId,
			name: input.name,
			color: input.color,
		});
	}),

	/**
	 * Generic custom-field-creation dispatch (plan 010/1). Replaces the
	 * legacy per-provider `createTrelloCustomField` / `createJiraCustomField`
	 * procedures.
	 */
	createCustomField: protectedProcedure
		.input(createCustomFieldInput)
		.mutation(async ({ ctx, input }) => {
			const manifest = getPMProvider(input.providerId);
			if (!manifest) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Unknown PM provider '${input.providerId}'. Registered providers: ${listPMProviders()
						.map((m) => m.id)
						.join(', ')}`,
				});
			}
			if (!manifest.createCustomField) {
				throw new TRPCError({
					code: 'NOT_IMPLEMENTED',
					message:
						`Provider '${input.providerId}' does not declare createCustomField. ` +
						`Declare it on manifest in ${input.providerId}/manifest.ts to serve custom-field creation.`,
				});
			}
			const credentials = await resolvePMCredentials({
				providerId: input.providerId,
				effectiveOrgId: ctx.effectiveOrgId,
				credentials: input.credentials,
				projectId: input.projectId,
			});
			return manifest.createCustomField({
				credentials,
				containerId: input.containerId,
				name: input.name,
			});
		}),
});
