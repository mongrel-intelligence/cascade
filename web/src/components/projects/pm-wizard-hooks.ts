/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 *
 * Generic hooks introduced in spec 013 refactor:
 *   - buildProviderAuthArg    — single auth-arg builder for all three providers
 *   - useProviderLabelCreation— parameterized label-creation hook (replaces 2 copies)
 *   - useProviderCustomFieldCreation — parameterized CF hook (replaces 2 copies)
 *   - useSaveMutation         — data-driven, no provider branching
 *
 * JIRA and Linear thin wrappers remain exported here for compatibility while
 * Trello-owned setup logic lives under pm-providers/trello/hooks.ts.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { getCredentialRoles } from '../../../../src/config/integrationRoles.js';
import type { ProviderAuthMetadata, ProviderWizardDefinition } from './pm-providers/types.js';
import type {
	LinearProjectOption,
	LinearTeamDetails,
	LinearTeamOption,
	WizardAction,
	WizardState,
} from './pm-wizard-state.js';
import { shouldUseStoredCredentials } from './pm-wizard-state.js';

// ============================================================================
// Auth-arg builder — shared across all mutations
// ============================================================================

/**
 * Build the `{ projectId }` or `{ credentials: ... }` portion of a tRPC
 * request for any provider. Returns the stored-creds path when the user is
 * editing an existing integration without re-typing their key.
 *
 * Extracted so every per-provider mutation stays below the cognitive-
 * complexity threshold and a single place enforces the invariant.
 */
export function buildProviderAuthArg(
	state: WizardState,
	projectId: string,
): { projectId: string } | { credentials: Record<string, string> } {
	if (shouldUseStoredCredentials(state)) {
		return { projectId };
	}
	if (state.provider === 'trello') {
		if (!state.trelloApiKey || !state.trelloToken) {
			throw new Error('Enter both credentials before verifying');
		}
		return { credentials: { api_key: state.trelloApiKey, token: state.trelloToken } };
	}
	if (state.provider === 'linear') {
		if (!state.linearApiKey) {
			throw new Error('Enter your API key before verifying');
		}
		return { credentials: { api_key: state.linearApiKey } };
	}
	// jira
	if (!state.jiraEmail || !state.jiraApiToken) {
		throw new Error('Enter both credentials before verifying');
	}
	return {
		credentials: {
			email: state.jiraEmail,
			api_token: state.jiraApiToken,
			base_url: state.jiraBaseUrl,
		},
	};
}

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
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	const createLabelMutation = useMutation({
		mutationFn: (vars: { name: string; color?: string; slot: string }) => {
			const containerId = config.getContainerId(state);
			if (!containerId) throw new Error(config.containerError);
			const authArg = buildProviderAuthArg(state, projectId);
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
			const authArg = buildProviderAuthArg(state, projectId);
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
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	const createCustomFieldMutation = useMutation({
		mutationFn: ({ name }: { name: string }) => {
			const containerId = config.getContainerId(state);
			if (!containerId && config.containerError) throw new Error(config.containerError);
			const authArg = buildProviderAuthArg(state, projectId);
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
// JIRA Discovery
// ============================================================================

export function useJiraDiscovery(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const jiraProjectsMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: routes through generic pm.discovery.discover.
			if (state.isEditing && state.hasStoredCredentials && !state.jiraEmail) {
				const projects = (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'jira',
					capability: 'projects',
					args: {},
					projectId,
				})) as Array<{ id: string; name: string }>;
				// Legacy shape has `key` — pm.discover returns `id` containing
				// the JIRA key. Normalize for downstream consumers.
				return projects.map((p) => ({ key: p.id, name: p.name }));
			}
			if (!state.jiraEmail || !state.jiraApiToken) {
				throw new Error('Enter both credentials before fetching projects');
			}
			const projects = (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'jira',
				capability: 'projects',
				args: {},
				credentials: {
					email: state.jiraEmail,
					api_token: state.jiraApiToken,
					base_url: state.jiraBaseUrl,
				},
			})) as Array<{ id: string; name: string }>;
			return projects.map((p) => ({ key: p.id, name: p.name }));
		},
		onSuccess: (projects) => dispatch({ type: 'SET_JIRA_PROJECTS', projects }),
	});

	const jiraDetailsMutation = useMutation({
		mutationFn: (projectKey: string) => {
			if (state.isEditing && state.hasStoredCredentials && !state.jiraEmail) {
				return trpcClient.integrationsDiscovery.jiraProjectDetailsByProject.mutate({
					projectId,
					projectKey,
				});
			}
			if (!state.jiraEmail || !state.jiraApiToken) {
				throw new Error('Enter both credentials before fetching project details');
			}
			return trpcClient.integrationsDiscovery.jiraProjectDetails.mutate({
				email: state.jiraEmail,
				apiToken: state.jiraApiToken,
				baseUrl: state.jiraBaseUrl,
				projectKey,
			});
		},
		onSuccess: (details) => {
			dispatch({ type: 'SET_JIRA_PROJECT_DETAILS', details });
			advanceToStep(4);
		},
	});

	const handleProjectSelect = (key: string) => {
		dispatch({ type: 'SET_JIRA_PROJECT_KEY', key });
		if (key) {
			jiraDetailsMutation.mutate(key);
		}
	};

	// Auto-fetch projects when verification result changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification result change
	useEffect(() => {
		if (!state.verificationResult || state.provider !== 'jira') return;
		if (state.jiraProjects.length === 0 && !jiraProjectsMutation.isPending) {
			jiraProjectsMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult]);

	// In edit mode, auto-fetch project list and details
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on edit mode and stored creds
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'jira') return;
		const canFetch = state.jiraEmail ? !!state.jiraApiToken : state.hasStoredCredentials;
		if (canFetch && state.jiraProjects.length === 0 && !jiraProjectsMutation.isPending) {
			jiraProjectsMutation.mutate();
		}
		if (
			state.jiraProjectKey &&
			!state.jiraProjectDetails &&
			canFetch &&
			!jiraDetailsMutation.isPending
		) {
			jiraDetailsMutation.mutate(state.jiraProjectKey);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.jiraProjectKey, state.hasStoredCredentials]);

	return { jiraProjectsMutation, jiraDetailsMutation, handleProjectSelect };
}

// ============================================================================
// Linear Discovery
// ============================================================================

export function useLinearDiscovery(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const linearTeamsMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: routes through generic pm.discovery.discover.
			if (state.isEditing && state.hasStoredCredentials && !state.linearApiKey) {
				return (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'linear',
					capability: 'teams',
					args: {},
					projectId,
				})) as Array<{ id: string; name: string }>;
			}
			if (!state.linearApiKey) {
				throw new Error('Enter your API key before fetching teams');
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'linear',
				capability: 'teams',
				args: {},
				credentials: { api_key: state.linearApiKey },
			})) as Array<{ id: string; name: string }>;
		},
		onSuccess: (teams) =>
			dispatch({
				type: 'SET_LINEAR_TEAMS',
				teams: teams as LinearTeamOption[],
			}),
	});

	const linearDetailsMutation = useMutation({
		mutationFn: (teamId: string) => {
			if (state.isEditing && state.hasStoredCredentials && !state.linearApiKey) {
				return trpcClient.integrationsDiscovery.linearTeamDetailsByProject.mutate({
					projectId,
					teamId,
				});
			}
			if (!state.linearApiKey) {
				throw new Error('Enter your API key before fetching team details');
			}
			return trpcClient.integrationsDiscovery.linearTeamDetails.mutate({
				apiKey: state.linearApiKey,
				teamId,
			});
		},
		onSuccess: (details) => {
			dispatch({
				type: 'SET_LINEAR_TEAM_DETAILS',
				details: details as LinearTeamDetails,
			});
			advanceToStep(4);
		},
	});

	const linearProjectsMutation = useMutation({
		mutationFn: async (teamId: string) => {
			// Plan 010/2: routes through generic pm.discovery.discover.
			if (state.isEditing && state.hasStoredCredentials && !state.linearApiKey) {
				return (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'linear',
					capability: 'projects',
					args: { containerId: teamId },
					projectId,
				})) as Array<{ id: string; name: string }>;
			}
			if (!state.linearApiKey) {
				throw new Error('Enter your API key before fetching projects');
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'linear',
				capability: 'projects',
				args: { containerId: teamId },
				credentials: { api_key: state.linearApiKey },
			})) as Array<{ id: string; name: string }>;
		},
		onSuccess: (projects) =>
			dispatch({
				type: 'SET_LINEAR_PROJECTS',
				projects: projects as LinearProjectOption[],
			}),
	});

	const handleTeamSelect = (teamId: string) => {
		dispatch({ type: 'SET_LINEAR_TEAM_ID', id: teamId });
		if (teamId) {
			linearDetailsMutation.mutate(teamId);
			linearProjectsMutation.mutate(teamId);
		}
	};

	// Auto-fetch teams when verification result changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification result change
	useEffect(() => {
		if (!state.verificationResult || state.provider !== 'linear') return;
		if (state.linearTeams.length === 0 && !linearTeamsMutation.isPending) {
			linearTeamsMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult]);

	// In edit mode, auto-fetch team list and details
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on edit mode and stored creds
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'linear') return;
		const canFetch = state.linearApiKey ? true : state.hasStoredCredentials;
		if (canFetch && state.linearTeams.length === 0 && !linearTeamsMutation.isPending) {
			linearTeamsMutation.mutate();
		}
		if (
			state.linearTeamId &&
			!state.linearTeamDetails &&
			canFetch &&
			!linearDetailsMutation.isPending
		) {
			linearDetailsMutation.mutate(state.linearTeamId);
		}
		if (
			state.linearTeamId &&
			state.linearProjects.length === 0 &&
			canFetch &&
			!linearProjectsMutation.isPending
		) {
			linearProjectsMutation.mutate(state.linearTeamId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.linearTeamId, state.hasStoredCredentials]);

	return { linearTeamsMutation, linearDetailsMutation, linearProjectsMutation, handleTeamSelect };
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

export function formatVerificationDisplay(
	provider: string,
	me: { id: string; name: string; displayName?: string },
): string {
	// Per-provider display formatting mirrors the pre-009/5 UX:
	//   Trello: "@{username} ({fullName})"   — displayName is username
	//   JIRA:   "{displayName} ({email})"     — displayName is email
	//   Linear: "{displayName || name}"       — displayName is the preferred handle
	if (provider === 'trello') {
		return me.displayName ? `@${me.displayName} (${me.name})` : me.name;
	}
	if (provider === 'jira') {
		return me.displayName ? `${me.name} (${me.displayName})` : me.name;
	}
	return me.displayName || me.name;
}

export function useVerification(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
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
				result: { provider, display: formatVerificationDisplay(provider, me) },
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
// JIRA Custom Field Creation
// ============================================================================

export function useJiraCustomFieldCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	const inner = useProviderCustomFieldCreation(
		{
			providerId: 'jira',
			// JIRA fields are global; containerId is sent as-is for uniform shape
			getContainerId: (s) => s.jiraProjectKey || 'global',
			addCustomField: (f) => ({
				type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD',
				field: { ...f, custom: true },
			}),
			setCostField: (id) => ({ type: 'SET_JIRA_COST_FIELD', id }),
			onError: (error) => {
				console.error('Failed to create JIRA custom field:', error);
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes('403') || message.toLowerCase().includes('admin')) {
					alert(
						'Failed to create custom field: JIRA admin permissions are required to create global custom fields. Please contact your JIRA administrator.',
					);
				} else {
					alert(`Failed to create JIRA custom field: ${message}`);
				}
			},
		},
		state,
		dispatch,
		projectId,
	);
	// Preserve the legacy export name for JIRA callers
	return { createJiraCustomFieldMutation: inner.createCustomFieldMutation };
}

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

// ============================================================================
// Linear Label Creation
// ============================================================================

export function useLinearLabelCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	return useProviderLabelCreation(
		{
			providerId: 'linear',
			getContainerId: (s) => s.linearTeamId,
			containerError: 'Team must be selected before creating a label',
			addLabel: (label) => ({ type: 'ADD_LINEAR_TEAM_LABEL', label }),
			setLabelMapping: (slot, id) => ({ type: 'SET_LINEAR_LABEL', key: slot, value: id }),
		},
		state,
		dispatch,
		projectId,
	);
}

export type { CustomFieldCreationConfig, LabelCreationConfig };
// Re-export the generic utilities for direct use in tests / advanced consumers
export { useProviderCustomFieldCreation, useProviderLabelCreation };
