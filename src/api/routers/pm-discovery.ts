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
import { getPMProvider, listPMProviders } from '../../integrations/pm/registry.js';
import { protectedProcedure, router } from '../trpc.js';

const providerIdInput = z.object({
	providerId: z.string().min(1),
});

const DISCOVERY_CAPABILITIES = [
	'teams',
	'boards',
	'labels',
	'states',
	'projects',
	'customFields',
	'containers',
] as const;

const discoverInput = z.object({
	providerId: z.string().min(1),
	capability: z.enum(DISCOVERY_CAPABILITIES),
	args: z.record(z.string(), z.unknown()).default({}),
	credentials: z.record(z.string(), z.string()).optional(),
});

const createLabelInput = z.object({
	providerId: z.string().min(1),
	containerId: z.string().min(1),
	name: z.string().min(1),
	color: z.string().optional(),
	credentials: z.record(z.string(), z.string()).default({}),
});

const createCustomFieldInput = z.object({
	providerId: z.string().min(1),
	containerId: z.string().min(1),
	name: z.string().min(1),
	credentials: z.record(z.string(), z.string()).default({}),
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
	discover: protectedProcedure.input(discoverInput).mutation(async ({ input }) => {
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

		const provider = manifest.createDiscoveryProvider({ credentials: input.credentials });
		if (!provider.discover) {
			throw new TRPCError({
				code: 'NOT_IMPLEMENTED',
				message: `Provider '${input.providerId}' adapter does not implement discover().`,
			});
		}

		// Call through with the raw args — the adapter is responsible for
		// any runtime narrowing (e.g. parseContainerId). Capability + args
		// typing is enforced at the adapter's method signature in plans 2/3/4.
		return provider.discover(input.capability, input.args as never);
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
	createLabel: protectedProcedure.input(createLabelInput).mutation(async ({ input }) => {
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
		return manifest.createLabel({
			credentials: input.credentials,
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
		.mutation(async ({ input }) => {
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
			return manifest.createCustomField({
				credentials: input.credentials,
				containerId: input.containerId,
				name: input.name,
			});
		}),
});
