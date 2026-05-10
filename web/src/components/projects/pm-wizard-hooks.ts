/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 *
 * Generic hooks introduced in spec 013 refactor:
 *   - buildProviderAuthArgFromMetadata — auth-arg builder driven by provider metadata
 *   - useProviderLabelCreation— parameterized label-creation hook (replaces 2 copies)
 *   - useProviderCustomFieldCreation — parameterized CF hook (replaces 2 copies)
 *   - useSaveMutation         — data-driven, no provider branching
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { getCredentialRoles } from '../../../../src/config/integrationRoles.js';
import type { ProviderAuthMetadata, ProviderWizardDefinition } from './pm-providers/types.js';
import type { WizardAction, WizardState } from './pm-wizard-state.js';
import { shouldUseStoredCredentials } from './pm-wizard-state.js';

export function buildProviderAuthArgFromMetadata(
	state: WizardState,
	projectId: string,
	metadata: ProviderAuthMetadata,
): { projectId: string } | { credentials: Record<string, string> } {
	if (
		shouldUseStoredCredentials(state) &&
		!state[metadata.storedCredentials.fallbackWhenStateFieldEmpty]
	) {
		return { projectId };
	}

	const credentials: Record<string, string> = {};
	for (const field of metadata.rawCredentials) {
		const rawValue = state[field.stateField];
		const value = typeof rawValue === 'string' ? rawValue : '';
		if (!value) {
			throw new Error(field.missingMessage ?? metadata.missingCredentialsMessage);
		}
		credentials[field.role] = value;
	}
	return { credentials };
}

// ============================================================================
// Label creation utilities
// ============================================================================

/**
 * Iterate `labelsToCreate` through `pm.discovery.createLabel`, collecting
 * successes + per-name errors. Factored out so the two
 * `createMissingLabelsMutation` bodies (Trello + Linear) stay below the
 * biome cognitive-complexity threshold.
 */
export async function runPerLabelCreations(opts: {
	labelsToCreate: Array<{ slot: string; name: string; color?: string }>;
	providerId: 'trello' | 'linear';
	containerId: string;
	authArg: { projectId: string } | { credentials: Record<string, string> };
}): Promise<{
	successes: Array<{ id: string; name: string; color: string }>;
	errors: Array<{ name: string; error: string }>;
}> {
	const successes: Array<{ id: string; name: string; color: string }> = [];
	const errors: Array<{ name: string; error: string }> = [];
	for (const { name, color } of opts.labelsToCreate) {
		try {
			const label = await trpcClient.pm.discovery.createLabel.mutate({
				providerId: opts.providerId,
				containerId: opts.containerId,
				name,
				color,
				...opts.authArg,
			});
			successes.push(label);
		} catch (err) {
			errors.push({ name, error: err instanceof Error ? err.message : String(err) });
		}
	}
	return { successes, errors };
}

// ============================================================================
// Generic label-creation hook
// ============================================================================

interface LabelCreationConfig {
	providerId: 'trello' | 'linear';
	/** Provider-owned auth contract for raw credentials and stored fallback */
	auth: ProviderAuthMetadata;
	/** Returns the container ID (board / team) from state */
	getContainerId: (state: WizardState) => string;
	/** Error when container not yet selected */
	containerError: string;
	/** Dispatch to add a newly created label to the local list */
	addLabel: (label: { id: string; name: string; color: string }) => WizardAction;
	/** Dispatch to map a slot to the newly created label ID */
	setLabelMapping: (slot: string, id: string) => WizardAction;
}

function useProviderLabelCreation(
	config: LabelCreationConfig,
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	const createLabelMutation = useMutation({
		mutationFn: (vars: { name: string; color?: string; slot: string }) => {
			const containerId = config.getContainerId(state);
			if (!containerId) throw new Error(config.containerError);
			const authArg = buildProviderAuthArgFromMetadata(state, projectId, config.auth);
			return trpcClient.pm.discovery.createLabel.mutate({
				providerId: config.providerId,
				containerId,
				name: vars.name,
				color: vars.color,
				...authArg,
			});
		},
		onSuccess: (label, vars) => {
			dispatch(config.addLabel(label));
			dispatch(config.setLabelMapping(vars.slot, label.id));
		},
		onError: (error) => {
			console.error('Failed to create label:', error);
			alert(`Failed to create label: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	const createMissingLabelsMutation = useMutation({
		mutationFn: async (labelsToCreate: Array<{ slot: string; name: string; color?: string }>) => {
			const containerId = config.getContainerId(state);
			if (!containerId) throw new Error(config.containerError);
			const authArg = buildProviderAuthArgFromMetadata(state, projectId, config.auth);
			return runPerLabelCreations({
				labelsToCreate,
				providerId: config.providerId,
				containerId,
				authArg,
			});
		},
		onSuccess: (result, labelsToCreate) => {
			for (const label of result.successes) {
				const slot = labelsToCreate.find((l) => l.name === label.name)?.slot;
				if (slot) {
					dispatch(config.addLabel(label));
					dispatch(config.setLabelMapping(slot, label.id));
				}
			}
			if (result.errors.length > 0) {
				const errorMsg = result.errors.map((e) => `${e.name}: ${e.error}`).join('\n');
				alert(
					`Some labels failed to create:\n${errorMsg}\n\n${result.successes.length} label(s) created successfully.`,
				);
			}
		},
		onError: (error) => {
			console.error('Failed to create labels:', error);
			alert(`Failed to create labels: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	return { createLabelMutation, createMissingLabelsMutation };
}

// ============================================================================
// Generic custom-field-creation hook
// ============================================================================

interface CustomFieldCreationConfig {
	providerId: 'trello' | 'jira';
	/** Provider-owned auth contract for raw credentials and stored fallback */
	auth: ProviderAuthMetadata;
	/** Returns the container ID from state (boardId / projectKey) */
	getContainerId: (state: WizardState) => string;
	/** Error thrown when container not yet selected (required for Trello; omit for global providers like JIRA) */
	containerError?: string;
	/** Dispatch to add a new custom field to the local list */
	addCustomField: (field: { id: string; name: string; type: string }) => WizardAction;
	/** Dispatch to set the cost field ID */
	setCostField: (id: string) => WizardAction;
	/** Optional override for error handling (default: generic alert) */
	onError?: (error: unknown) => void;
}

function useProviderCustomFieldCreation(
	config: CustomFieldCreationConfig,
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	const createCustomFieldMutation = useMutation({
		mutationFn: ({ name }: { name: string }) => {
			const containerId = config.getContainerId(state);
			if (!containerId && config.containerError) throw new Error(config.containerError);
			const authArg = buildProviderAuthArgFromMetadata(state, projectId, config.auth);
			return trpcClient.pm.discovery.createCustomField.mutate({
				providerId: config.providerId,
				containerId: containerId || 'global',
				name,
				...authArg,
			});
		},
		onSuccess: (customField) => {
			dispatch(
				config.addCustomField({
					id: customField.id,
					name: customField.name,
					type: customField.type,
				}),
			);
			dispatch(config.setCostField(customField.id));
		},
		onError: (error) => {
			if (config.onError) {
				config.onError(error);
				return;
			}
			console.error('Failed to create custom field:', error);
			const message = error instanceof Error ? error.message : String(error);
			alert(`Failed to create custom field: ${message}`);
		},
	});

	return { createCustomFieldMutation };
}

// ============================================================================
// Verification
// ============================================================================

export function buildCurrentUserDiscoveryRequest(
	state: WizardState,
	projectId: string,
	manifestDef: ProviderWizardDefinition,
): {
	providerId: string;
	capability: 'currentUser';
	args: Record<string, never>;
} & ({ projectId: string } | { credentials: Record<string, string> }) {
	return {
		providerId: manifestDef.id,
		capability: 'currentUser',
		args: {},
		...buildProviderAuthArgFromMetadata(state, projectId, manifestDef.auth),
	};
}

export function useVerification(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
	manifestDef: ProviderWizardDefinition,
) {
	const verifyMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: restore the pre-009/5 "Verified as @username" UX.
			// Calls the `currentUser` discovery capability; every provider
			// maps its native `getMe()` response to `{ id, name, displayName? }`.
			//
			// Edit-mode fallback comes from the provider-owned auth metadata:
			// empty raw credential fields in edit mode send `{ projectId }`,
			// letting the backend resolve stored project credentials.
			const request = buildCurrentUserDiscoveryRequest(state, projectId, manifestDef);
			const me = (await trpcClient.pm.discovery.discover.mutate(request)) as {
				id: string;
				name: string;
				displayName?: string;
			};
			return { provider: manifestDef.id, me };
		},
		onSuccess: ({ provider, me }) => {
			// Ignore if provider changed while we were verifying
			if (provider !== state.provider) return;
			dispatch({
				type: 'SET_VERIFICATION',
				result: { provider, display: manifestDef.formatVerificationDisplay(me) },
			});
			advanceToStep(3);
		},
		onError: (err) => {
			dispatch({
				type: 'SET_VERIFICATION',
				result: null,
				error: err instanceof Error ? err.message : String(err),
			});
		},
	});

	return { verifyMutation };
}

// Plan 012/4: `useWebhookManagement` + `useLinearWebhookInfo` deleted.
// Each provider's `useProviderHooks` now inlines the webhook plumbing
// (`webhooks.list/create/delete` + `callbackBaseUrl` formula) —
// see `./pm-providers/{trello,jira,linear}/wizard.ts`.

// ============================================================================
// Save Mutation — data-driven, no per-provider branching
// ============================================================================

export function buildPersistedCredentialInputs(
	state: WizardState,
	manifestDef: ProviderWizardDefinition,
): Array<{ envVarKey: string; value: string; name: string }> {
	return manifestDef.credentialPersistence.flatMap((cred) => {
		const rawValue = state[cred.stateField];
		const value = typeof rawValue === 'string' ? rawValue : '';
		return value ? [{ envVarKey: cred.envVarKey, value, name: cred.label }] : [];
	});
}

export function buildIntegrationUpsertInput(
	projectId: string,
	state: WizardState,
	manifestDef: ProviderWizardDefinition,
): {
	projectId: string;
	category: 'pm';
	provider: string;
	config: Record<string, unknown>;
} {
	return {
		projectId,
		category: 'pm',
		provider: manifestDef.id,
		config: manifestDef.buildIntegrationConfig(state),
	};
}

export function useSaveMutation(
	projectId: string,
	state: WizardState,
	manifestDef: ProviderWizardDefinition,
) {
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		mutationFn: async () => {
			const result = await trpcClient.projects.integrations.upsert.mutate(
				buildIntegrationUpsertInput(projectId, state, manifestDef),
			);

			// Persist credentials to project_credentials table
			for (const cred of buildPersistedCredentialInputs(state, manifestDef)) {
				await trpcClient.projects.credentials.set.mutate({ projectId, ...cred });
			}

			// On first-time setup, auto-enable default PM triggers for the three main agents
			if (!state.isEditing) {
				await trpcClient.agentTriggerConfigs.bulkUpsert.mutate({
					projectId,
					configs: [
						{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
						{ agentType: 'splitting', triggerEvent: 'pm:status-changed', enabled: true },
						{ agentType: 'planning', triggerEvent: 'pm:status-changed', enabled: true },
					],
				});
			}

			// If the user switched provider mid-edit, clean up the old provider's credentials.
			if (state.previousProvider && state.previousProvider !== state.provider) {
				const oldKeys = getCredentialRoles(state.previousProvider).map((r) => r.envVarKey);
				await Promise.all(
					oldKeys.map((envVarKey) =>
						trpcClient.projects.credentials.delete.mutate({ projectId, envVarKey }),
					),
				);
			}

			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.credentials.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.agentTriggerConfigs.listByProject.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return { saveMutation };
}

export type { CustomFieldCreationConfig, LabelCreationConfig };
// Re-export the generic utilities for direct use in tests / advanced consumers
export { useProviderCustomFieldCreation, useProviderLabelCreation };
