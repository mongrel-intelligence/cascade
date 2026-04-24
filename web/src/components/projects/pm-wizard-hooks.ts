/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 *
 * Generic hooks introduced in spec 013 refactor:
 *   - buildProviderAuthArg    — single auth-arg builder for all three providers
 *   - useProviderDiscovery    — parameterized discovery hook (replaces 3 copies)
 *   - useProviderLabelCreation— parameterized label-creation hook (replaces 2 copies)
 *   - useProviderCustomFieldCreation — parameterized CF hook (replaces 2 copies)
 *   - useSaveMutation         — data-driven, no provider branching
 *
 * Per-provider thin wrappers (useTrelloDiscovery, etc.) remain exported for
 * backward-compatibility with existing wizard.ts imports.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { getCredentialRoles } from '../../../../src/config/integrationRoles.js';
import type { DiscoveryCapability } from '../../../../src/pm/types.js';
import type {
	LinearProjectOption,
	LinearTeamDetails,
	LinearTeamOption,
	Provider,
	WizardAction,
	WizardState,
} from './pm-wizard-state.js';
import {
	buildJiraIntegrationConfig,
	buildLinearIntegrationConfig,
	buildTrelloIntegrationConfig,
	shouldUseStoredCredentials,
} from './pm-wizard-state.js';

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

// ============================================================================
// Generic discovery hook
// ============================================================================

interface DiscoveryConfig<TItem, TDetail> {
	providerId: Provider;
	/** Primary list capability, e.g. 'boards' | 'projects' | 'teams' */
	capability: DiscoveryCapability;
	/** Returns the current list from state (used for "already loaded?" guard) */
	getList: (state: WizardState) => TItem[];
	/** Returns the selected ID from state (used for edit-mode detail fetch) */
	getSelectedId: (state: WizardState) => string;
	/** Returns the cached details from state (used for "already loaded?" guard) */
	getDetails: (state: WizardState) => TDetail | null;
	/** Dispatch action to set the list */
	setList: (items: TItem[]) => WizardAction;
	/** Dispatch action to set the selection */
	setSelected: (id: string) => WizardAction;
	/** Dispatch action to set the detail object */
	setDetails: (details: TDetail | null) => WizardAction;
	/** Extra args passed to the discovery endpoint (e.g. { containerId }) */
	listArgs?: Record<string, unknown>;
	/** Error message when primary list credentials missing */
	listCredentialError: string;
	/** Error message when detail-fetch credentials missing */
	detailCredentialError: string;
}

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
// Generic discovery hook
// ============================================================================

function useProviderDiscovery<TItem, TDetail>(
	config: DiscoveryConfig<TItem, TDetail>,
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	const listMutation = useMutation({
		mutationFn: async () => {
			const authArg = buildProviderAuthArg(state, projectId);
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: config.providerId,
				capability: config.capability,
				args: config.listArgs ?? {},
				...authArg,
			})) as TItem[];
		},
		onSuccess: (items) => dispatch(config.setList(items)),
	});

	const detailsMutation = useMutation({
		mutationFn: async (selectedId: string): Promise<TDetail> => {
			const authArg = buildProviderAuthArg(state, projectId);
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: config.providerId,
				capability: `${config.capability.replace(/s$/, '')}Details` as DiscoveryCapability,
				args: { containerId: selectedId },
				...authArg,
			})) as TDetail;
		},
		onSuccess: (details) => dispatch(config.setDetails(details)),
	});

	// Auto-fetch list when verification result changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification result change
	useEffect(() => {
		if (!state.verificationResult || state.provider !== config.providerId) return;
		if (config.getList(state).length === 0 && !listMutation.isPending) {
			listMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult]);

	// In edit mode, auto-fetch list and details
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on edit mode and stored creds
	useEffect(() => {
		if (!state.isEditing || state.provider !== config.providerId) return;
		const canFetch = shouldUseStoredCredentials(state) || hasCredentials(state);
		if (canFetch && config.getList(state).length === 0 && !listMutation.isPending) {
			listMutation.mutate();
		}
		const selectedId = config.getSelectedId(state);
		if (selectedId && !config.getDetails(state) && canFetch && !detailsMutation.isPending) {
			detailsMutation.mutate(selectedId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, config.getSelectedId(state), state.hasStoredCredentials]);

	return { listMutation, detailsMutation };
}

/** Returns true when the current provider's raw credentials are filled in */
function hasCredentials(state: WizardState): boolean {
	if (state.provider === 'trello') return !!(state.trelloApiKey && state.trelloToken);
	if (state.provider === 'jira') return !!(state.jiraEmail && state.jiraApiToken);
	return !!state.linearApiKey;
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
			const containerId = config.getContainerId(state) || 'global';
			const authArg = buildProviderAuthArg(state, projectId);
			return trpcClient.pm.discovery.createCustomField.mutate({
				providerId: config.providerId,
				containerId,
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
// Trello Discovery
// ============================================================================

export function useTrelloDiscovery(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const boardsMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: routes through generic pm.discovery.discover.
			// In edit mode with stored credentials, pass projectId — the
			// endpoint resolves credentials from project_credentials.
			// Otherwise pass raw credentials from wizard state.
			if (state.isEditing && state.hasStoredCredentials && !state.trelloApiKey) {
				return (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'trello',
					capability: 'boards',
					args: {},
					projectId,
				})) as Array<{ id: string; name: string; url?: string }>;
			}
			if (!state.trelloApiKey || !state.trelloToken) {
				throw new Error('Enter both credentials before fetching boards');
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'trello',
				capability: 'boards',
				args: {},
				credentials: { api_key: state.trelloApiKey, token: state.trelloToken },
			})) as Array<{ id: string; name: string; url?: string }>;
		},
		onSuccess: (boards) =>
			dispatch({
				type: 'SET_TRELLO_BOARDS',
				boards: boards.map((b) => ({ ...b, url: b.url ?? '' })),
			}),
	});

	const boardDetailsMutation = useMutation({
		mutationFn: (boardId: string) => {
			if (state.isEditing && state.hasStoredCredentials && !state.trelloApiKey) {
				return trpcClient.integrationsDiscovery.trelloBoardDetailsByProject.mutate({
					projectId,
					boardId,
				});
			}
			if (!state.trelloApiKey || !state.trelloToken) {
				throw new Error('Enter both credentials before fetching board details');
			}
			return trpcClient.integrationsDiscovery.trelloBoardDetails.mutate({
				apiKey: state.trelloApiKey,
				token: state.trelloToken,
				boardId,
			});
		},
		onSuccess: (details) => {
			dispatch({ type: 'SET_TRELLO_BOARD_DETAILS', details });
			advanceToStep(4);
		},
	});

	const handleBoardSelect = (boardId: string) => {
		dispatch({ type: 'SET_TRELLO_BOARD_ID', id: boardId });
		if (boardId) {
			boardDetailsMutation.mutate(boardId);
		}
	};

	// Auto-fetch boards when verification result changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification result change
	useEffect(() => {
		if (!state.verificationResult || state.provider !== 'trello') return;
		if (state.trelloBoards.length === 0 && !boardsMutation.isPending) {
			boardsMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult]);

	// In edit mode, auto-fetch board list and details
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on edit mode and stored creds
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'trello') return;
		const canFetch = state.trelloApiKey ? !!state.trelloToken : state.hasStoredCredentials;
		if (canFetch && state.trelloBoards.length === 0 && !boardsMutation.isPending) {
			boardsMutation.mutate();
		}
		if (
			state.trelloBoardId &&
			!state.trelloBoardDetails &&
			canFetch &&
			!boardDetailsMutation.isPending
		) {
			boardDetailsMutation.mutate(state.trelloBoardId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.trelloBoardId, state.hasStoredCredentials]);

	return { boardsMutation, boardDetailsMutation, handleBoardSelect };
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

/**
 * Build the `{ projectId }` or `{ credentials: ... }` portion of a tRPC
 * request, picking the stored-creds path when the user is editing an
 * existing integration and hasn't re-typed the key. Extracted so the
 * `verifyMutation` body stays below the cognitive-complexity threshold.
 *
 * @deprecated Use `buildProviderAuthArg` directly.
 */
function buildVerifyAuthArg(
	state: WizardState,
	projectId: string,
): { projectId: string } | { credentials: Record<string, string> } {
	return buildProviderAuthArg(state, projectId);
}

export function useVerification(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const verifyMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: restore the pre-009/5 "Verified as @username" UX.
			// Calls the `currentUser` discovery capability; every provider
			// maps its native `getMe()` response to `{ id, name, displayName? }`.
			//
			// Edit-mode fallback: `buildVerifyAuthArg` returns `{ projectId }`
			// when the user is editing with stored credentials but an empty
			// API-key field, so the backend resolves the stored secret via
			// `resolvePMCredentials` instead of requiring re-entry.
			const provider = state.provider;
			const authArg = buildVerifyAuthArg(state, projectId);
			const me = (await trpcClient.pm.discovery.discover.mutate({
				providerId: provider,
				capability: 'currentUser',
				args: {},
				...authArg,
			})) as { id: string; name: string; displayName?: string };
			return { provider, me };
		},
		onSuccess: ({ provider, me }) => {
			// Ignore if provider changed while we were verifying
			if (provider !== state.provider) return;
			// Per-provider display formatting mirrors the pre-009/5 UX:
			//   Trello: "@{username} ({fullName})"   — displayName is username
			//   JIRA:   "{displayName} ({email})"     — displayName is email
			//   Linear: "{displayName || name}"       — displayName is the preferred handle
			let display: string;
			if (provider === 'trello') {
				display = me.displayName ? `@${me.displayName} (${me.name})` : me.name;
			} else if (provider === 'jira') {
				display = me.displayName ? `${me.name} (${me.displayName})` : me.name;
			} else {
				display = me.displayName || me.name;
			}
			dispatch({
				type: 'SET_VERIFICATION',
				result: { provider, display },
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
// Trello Label Creation
// ============================================================================

export function useTrelloLabelCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	return useProviderLabelCreation(
		{
			providerId: 'trello',
			getContainerId: (s) => s.trelloBoardId,
			containerError: 'Board must be selected before creating a label',
			addLabel: (label) => ({ type: 'ADD_TRELLO_BOARD_LABEL', label }),
			setLabelMapping: (slot, id) => ({ type: 'SET_TRELLO_LABEL_MAPPING', key: slot, value: id }),
		},
		state,
		dispatch,
		projectId,
	);
}

// ============================================================================
// Trello Custom Field Creation
// ============================================================================

export function useTrelloCustomFieldCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	projectId: string,
) {
	return useProviderCustomFieldCreation(
		{
			providerId: 'trello',
			getContainerId: (s) => s.trelloBoardId,
			addCustomField: (f) => ({ type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD', customField: f }),
			setCostField: (id) => ({ type: 'SET_TRELLO_COST_FIELD', id }),
			onError: (error) => {
				console.error('Failed to create custom field:', error);
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes('403')) {
					alert(
						'Failed to create custom field: The Trello Custom Fields power-up is required. Please enable it on your Trello board and try again.',
					);
				} else {
					alert(`Failed to create custom field: ${message}`);
				}
			},
		},
		state,
		dispatch,
		projectId,
	);
}

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

type CredentialEntry = { envVarKey: string; stateField: keyof WizardState; label: string };

const SAVE_CONFIGS: Record<
	Provider,
	{
		buildConfig: (state: WizardState) => Record<string, unknown>;
		credentials: CredentialEntry[];
	}
> = {
	trello: {
		buildConfig: buildTrelloIntegrationConfig,
		credentials: [
			{ envVarKey: 'TRELLO_API_KEY', stateField: 'trelloApiKey', label: 'Trello API Key' },
			{ envVarKey: 'TRELLO_TOKEN', stateField: 'trelloToken', label: 'Trello Token' },
		],
	},
	jira: {
		buildConfig: buildJiraIntegrationConfig,
		credentials: [
			{ envVarKey: 'JIRA_EMAIL', stateField: 'jiraEmail', label: 'JIRA Email' },
			{ envVarKey: 'JIRA_API_TOKEN', stateField: 'jiraApiToken', label: 'JIRA API Token' },
		],
	},
	linear: {
		buildConfig: buildLinearIntegrationConfig,
		credentials: [
			{ envVarKey: 'LINEAR_API_KEY', stateField: 'linearApiKey', label: 'Linear API Key' },
		],
	},
};

export function useSaveMutation(projectId: string, state: WizardState) {
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		mutationFn: async () => {
			const providerCfg = SAVE_CONFIGS[state.provider];
			const config = providerCfg.buildConfig(state);

			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'pm',
				provider: state.provider,
				config,
			});

			// Persist credentials to project_credentials table
			for (const cred of providerCfg.credentials) {
				const value = state[cred.stateField] as string;
				if (value) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: cred.envVarKey,
						value,
						name: cred.label,
					});
				}
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

export type { CustomFieldCreationConfig, DiscoveryConfig, LabelCreationConfig };
// Re-export the generic utilities for direct use in tests / advanced consumers
export { useProviderCustomFieldCreation, useProviderDiscovery, useProviderLabelCreation };
