/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { getCredentialRoles } from '../../../../src/config/integrationRoles.js';
import type {
	LinearProjectOption,
	LinearTeamDetails,
	LinearTeamOption,
	WizardAction,
	WizardState,
} from './pm-wizard-state.js';
import { buildLinearIntegrationConfig } from './pm-wizard-state.js';

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

export function useVerification(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const verifyMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: restore the pre-009/5 "Verified as @username" UX.
			// Calls the new `currentUser` discovery capability, which every
			// provider implements by mapping its native `getMe()` response
			// to `{ id, name, displayName? }`. A successful call simultaneously
			// validates the credentials and gives us the identity string to
			// display.
			const provider = state.provider;
			if (provider === 'trello') {
				if (!state.trelloApiKey || !state.trelloToken) {
					throw new Error('Enter both credentials before verifying');
				}
				const me = (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'trello',
					capability: 'currentUser',
					args: {},
					credentials: {
						api_key: state.trelloApiKey,
						token: state.trelloToken,
					},
				})) as { id: string; name: string; displayName?: string };
				return { provider: 'trello' as const, me };
			}
			if (provider === 'linear') {
				if (!state.linearApiKey) {
					throw new Error('Enter your API key before verifying');
				}
				const me = (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'linear',
					capability: 'currentUser',
					args: {},
					credentials: { api_key: state.linearApiKey },
				})) as { id: string; name: string; displayName?: string };
				return { provider: 'linear' as const, me };
			}
			if (!state.jiraEmail || !state.jiraApiToken) {
				throw new Error('Enter both credentials before verifying');
			}
			const me = (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'jira',
				capability: 'currentUser',
				args: {},
				credentials: {
					email: state.jiraEmail,
					api_token: state.jiraApiToken,
					base_url: state.jiraBaseUrl,
				},
			})) as { id: string; name: string; displayName?: string };
			return { provider: 'jira' as const, me };
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

// ============================================================================
// Webhook Management
// ============================================================================

export function useWebhookManagement(projectId: string, state: WizardState) {
	const queryClient = useQueryClient();
	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const createWebhookMutation = useMutation({
		mutationFn: () =>
			trpcClient.webhooks.create.mutate({
				projectId,
				callbackBaseUrl,
				trelloOnly: state.provider === 'trello' ? true : undefined,
				jiraOnly: state.provider === 'jira' ? true : undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const deleteWebhookMutation = useMutation({
		mutationFn: (deleteCallbackBaseUrl: string) =>
			trpcClient.webhooks.delete.mutate({
				projectId,
				callbackBaseUrl: deleteCallbackBaseUrl,
				trelloOnly: state.provider === 'trello' ? true : undefined,
				jiraOnly: state.provider === 'jira' ? true : undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return {
		callbackBaseUrl,
		createWebhookMutation,
		deleteWebhookMutation,
	};
}

// ============================================================================
// Linear Webhook Info (display-only)
// ============================================================================

export function useLinearWebhookInfo() {
	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const webhookUrl = callbackBaseUrl
		? `${callbackBaseUrl}/linear/webhook`
		: '<YOUR_CASCADE_HOST>/linear/webhook';

	return { webhookUrl };
}

// ============================================================================
// Trello Label Creation
// ============================================================================

export function useTrelloLabelCreation(state: WizardState, dispatch: React.Dispatch<WizardAction>) {
	const createLabelMutation = useMutation({
		mutationFn: (vars: { name: string; color?: string; slot: string }) => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			// Plan 010/1: routes through generic pm.discovery.createLabel.
			return trpcClient.pm.discovery.createLabel.mutate({
				providerId: 'trello',
				containerId: state.trelloBoardId,
				name: vars.name,
				color: vars.color,
				credentials: { api_key: state.trelloApiKey, token: state.trelloToken },
			});
		},
		onSuccess: (label, vars) => {
			dispatch({ type: 'ADD_TRELLO_BOARD_LABEL', label });
			dispatch({ type: 'SET_TRELLO_LABEL_MAPPING', key: vars.slot, value: label.id });
		},
		onError: (error) => {
			console.error('Failed to create label:', error);
			alert(`Failed to create label: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	const createMissingLabelsMutation = useMutation({
		mutationFn: async (labelsToCreate: Array<{ slot: string; name: string; color?: string }>) => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			// Plan 010/1: iterate single-item pm.discovery.createLabel client-side.
			// Collect successes + errors into the same shape the old batch endpoint
			// returned so onSuccess downstream logic doesn't need to change.
			const successes: Array<{ id: string; name: string; color: string }> = [];
			const errors: Array<{ name: string; error: string }> = [];
			for (const { name, color } of labelsToCreate) {
				try {
					const label = await trpcClient.pm.discovery.createLabel.mutate({
						providerId: 'trello',
						containerId: state.trelloBoardId,
						name,
						color,
						credentials: { api_key: state.trelloApiKey, token: state.trelloToken },
					});
					successes.push(label);
				} catch (err) {
					errors.push({ name, error: err instanceof Error ? err.message : String(err) });
				}
			}
			return { successes, errors };
		},
		onSuccess: (result, labelsToCreate) => {
			// Handle successful label creations
			for (let i = 0; i < result.successes.length; i++) {
				const label = result.successes[i];
				// Find the slot for this label by matching the name
				const slot = labelsToCreate.find((l) => l.name === label.name)?.slot;
				if (slot) {
					dispatch({ type: 'ADD_TRELLO_BOARD_LABEL', label });
					dispatch({ type: 'SET_TRELLO_LABEL_MAPPING', key: slot, value: label.id });
				}
			}

			// Show error feedback if any labels failed
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
// Trello Custom Field Creation
// ============================================================================

export function useTrelloCustomFieldCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
) {
	const createCustomFieldMutation = useMutation({
		// Plan 011/2: the shared custom-field-mapping step lets operators type
		// a name. `mutate({ name })` — callers without a preference pass
		// `{ name: 'Cost' }` to preserve the legacy default.
		mutationFn: ({ name }: { name: string }) => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			// Plan 010/1 (leftover caller): routes through pm.discovery.createCustomField.
			return trpcClient.pm.discovery.createCustomField.mutate({
				providerId: 'trello',
				containerId: state.trelloBoardId,
				name,
				credentials: {
					api_key: state.trelloApiKey,
					token: state.trelloToken,
				},
			});
		},
		onSuccess: (customField) => {
			dispatch({ type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD', customField });
			dispatch({ type: 'SET_TRELLO_COST_FIELD', id: customField.id });
		},
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
	});

	return { createCustomFieldMutation };
}

// ============================================================================
// JIRA Custom Field Creation
// ============================================================================

export function useJiraCustomFieldCreation(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
) {
	const createJiraCustomFieldMutation = useMutation({
		// Plan 011/3: the shared custom-field-mapping step lets operators type
		// a name; callers without a preference pass `{ name: 'Cost' }`.
		mutationFn: ({ name }: { name: string }) => {
			if (!state.jiraEmail || !state.jiraApiToken || !state.jiraBaseUrl) {
				throw new Error('Missing JIRA credentials or base URL');
			}
			// Plan 010/1: routes through generic pm.discovery.createCustomField.
			// JIRA's project key isn't needed for the mutation (fields are global)
			// but we pass the configured projectKey as containerId for uniform shape.
			return trpcClient.pm.discovery.createCustomField.mutate({
				providerId: 'jira',
				containerId: state.jiraProjectKey || 'global',
				name,
				credentials: {
					email: state.jiraEmail,
					api_token: state.jiraApiToken,
					base_url: state.jiraBaseUrl,
				},
			});
		},
		onSuccess: (field) => {
			dispatch({ type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD', field: { ...field, custom: true } });
			dispatch({ type: 'SET_JIRA_COST_FIELD', id: field.id });
		},
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
	});

	return { createJiraCustomFieldMutation };
}

// ============================================================================
// Save Mutation
// ============================================================================

export function useSaveMutation(projectId: string, state: WizardState) {
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handles three provider types + credential persisting
		mutationFn: async () => {
			let config: Record<string, unknown>;
			if (state.provider === 'trello') {
				config = {
					boardId: state.trelloBoardId,
					lists: state.trelloListMappings,
					labels: state.trelloLabelMappings,
					...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
				};
			} else if (state.provider === 'linear') {
				config = buildLinearIntegrationConfig(state);
			} else {
				config = {
					projectKey: state.jiraProjectKey,
					baseUrl: state.jiraBaseUrl,
					statuses: state.jiraStatusMappings,
					...(Object.keys(state.jiraIssueTypes).length > 0
						? { issueTypes: state.jiraIssueTypes }
						: {}),
					...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
					...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
				};
			}

			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'pm',
				provider: state.provider,
				config,
			});

			// Persist credentials to project_credentials table
			if (state.provider === 'trello') {
				if (state.trelloApiKey) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: 'TRELLO_API_KEY',
						value: state.trelloApiKey,
						name: 'Trello API Key',
					});
				}
				if (state.trelloToken) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: 'TRELLO_TOKEN',
						value: state.trelloToken,
						name: 'Trello Token',
					});
				}
			} else if (state.provider === 'linear') {
				if (state.linearApiKey) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: 'LINEAR_API_KEY',
						value: state.linearApiKey,
						name: 'Linear API Key',
					});
				}
			} else {
				if (state.jiraEmail) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: 'JIRA_EMAIL',
						value: state.jiraEmail,
						name: 'JIRA Email',
					});
				}
				if (state.jiraApiToken) {
					await trpcClient.projects.credentials.set.mutate({
						projectId,
						envVarKey: 'JIRA_API_TOKEN',
						value: state.jiraApiToken,
						name: 'JIRA API Token',
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

export function useLinearLabelCreation(state: WizardState, dispatch: React.Dispatch<WizardAction>) {
	const createLabelMutation = useMutation({
		mutationFn: (vars: { name: string; color?: string; slot: string }) => {
			if (!state.linearApiKey || !state.linearTeamId) {
				throw new Error('Missing credentials or team selection');
			}
			// Plan 010/1: routes through generic pm.discovery.createLabel.
			return trpcClient.pm.discovery.createLabel.mutate({
				providerId: 'linear',
				containerId: state.linearTeamId,
				name: vars.name,
				color: vars.color,
				credentials: { api_key: state.linearApiKey },
			});
		},
		onSuccess: (label, vars) => {
			dispatch({ type: 'ADD_LINEAR_TEAM_LABEL', label });
			dispatch({ type: 'SET_LINEAR_LABEL', key: vars.slot, value: label.id });
		},
		onError: (error) => {
			console.error('Failed to create Linear label:', error);
			alert(`Failed to create label: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	const createMissingLabelsMutation = useMutation({
		mutationFn: async (labelsToCreate: Array<{ slot: string; name: string; color?: string }>) => {
			if (!state.linearApiKey || !state.linearTeamId) {
				throw new Error('Missing credentials or team selection');
			}
			// Plan 010/1: iterate single-item pm.discovery.createLabel client-side.
			const successes: Array<{ id: string; name: string; color: string }> = [];
			const errors: Array<{ name: string; error: string }> = [];
			for (const { name, color } of labelsToCreate) {
				try {
					const label = await trpcClient.pm.discovery.createLabel.mutate({
						providerId: 'linear',
						containerId: state.linearTeamId,
						name,
						color,
						credentials: { api_key: state.linearApiKey },
					});
					successes.push(label);
				} catch (err) {
					errors.push({ name, error: err instanceof Error ? err.message : String(err) });
				}
			}
			return { successes, errors };
		},
		onSuccess: (result, labelsToCreate) => {
			for (const label of result.successes) {
				const slot = labelsToCreate.find((l) => l.name === label.name)?.slot;
				if (slot) {
					dispatch({ type: 'ADD_LINEAR_TEAM_LABEL', label });
					dispatch({ type: 'SET_LINEAR_LABEL', key: slot, value: label.id });
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
			console.error('Failed to create Linear labels:', error);
			alert(`Failed to create labels: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	return { createLabelMutation, createMissingLabelsMutation };
}
