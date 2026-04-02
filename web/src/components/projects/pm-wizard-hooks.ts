/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import type { WizardAction, WizardState } from './pm-wizard-state.js';

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
		mutationFn: () => {
			if (state.isEditing && state.hasStoredCredentials && !state.trelloApiKey) {
				return trpcClient.integrationsDiscovery.trelloBoardsByProject.mutate({ projectId });
			}
			if (!state.trelloApiKey || !state.trelloToken) {
				throw new Error('Enter both credentials before fetching boards');
			}
			return trpcClient.integrationsDiscovery.trelloBoards.mutate({
				apiKey: state.trelloApiKey,
				token: state.trelloToken,
			});
		},
		onSuccess: (boards) => dispatch({ type: 'SET_TRELLO_BOARDS', boards }),
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
		mutationFn: () => {
			if (state.isEditing && state.hasStoredCredentials && !state.jiraEmail) {
				return trpcClient.integrationsDiscovery.jiraProjectsByProject.mutate({ projectId });
			}
			if (!state.jiraEmail || !state.jiraApiToken) {
				throw new Error('Enter both credentials before fetching projects');
			}
			return trpcClient.integrationsDiscovery.jiraProjects.mutate({
				email: state.jiraEmail,
				apiToken: state.jiraApiToken,
				baseUrl: state.jiraBaseUrl,
			});
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
// Verification
// ============================================================================

export function useVerification(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const verifyMutation = useMutation({
		mutationFn: async () => {
			const provider = state.provider;
			if (provider === 'trello') {
				if (!state.trelloApiKey || !state.trelloToken) {
					throw new Error('Enter both credentials before verifying');
				}
				const result = await trpcClient.integrationsDiscovery.verifyTrello.mutate({
					apiKey: state.trelloApiKey,
					token: state.trelloToken,
				});
				return { provider: 'trello' as const, result };
			}
			if (!state.jiraEmail || !state.jiraApiToken) {
				throw new Error('Enter both credentials before verifying');
			}
			const result = await trpcClient.integrationsDiscovery.verifyJira.mutate({
				email: state.jiraEmail,
				apiToken: state.jiraApiToken,
				baseUrl: state.jiraBaseUrl,
			});
			return { provider: 'jira' as const, result };
		},
		onSuccess: ({ provider, result }) => {
			// Ignore if provider changed while we were verifying
			if (provider !== state.provider) return;
			if (provider === 'trello') {
				const r = result as { username: string; fullName: string };
				dispatch({
					type: 'SET_VERIFICATION',
					result: { provider: 'trello', display: `@${r.username} (${r.fullName})` },
				});
			} else {
				const r = result as { displayName: string; emailAddress: string };
				dispatch({
					type: 'SET_VERIFICATION',
					result: { provider: 'jira', display: `${r.displayName} (${r.emailAddress})` },
				});
			}
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
// Trello Label Creation
// ============================================================================

export function useTrelloLabelCreation(state: WizardState, dispatch: React.Dispatch<WizardAction>) {
	const createLabelMutation = useMutation({
		mutationFn: (vars: { name: string; color?: string; slot: string }) => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			return trpcClient.integrationsDiscovery.createTrelloLabel.mutate({
				apiKey: state.trelloApiKey,
				token: state.trelloToken,
				boardId: state.trelloBoardId,
				name: vars.name,
				color: vars.color,
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
		mutationFn: (labelsToCreate: Array<{ slot: string; name: string; color?: string }>) => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			return trpcClient.integrationsDiscovery.createTrelloLabels.mutate({
				apiKey: state.trelloApiKey,
				token: state.trelloToken,
				boardId: state.trelloBoardId,
				labels: labelsToCreate.map(({ name, color }) => ({ name, color })),
			});
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
		mutationFn: () => {
			if (!state.trelloApiKey || !state.trelloToken || !state.trelloBoardId) {
				throw new Error('Missing credentials or board selection');
			}
			return trpcClient.integrationsDiscovery.createTrelloCustomField.mutate({
				apiKey: state.trelloApiKey,
				token: state.trelloToken,
				boardId: state.trelloBoardId,
				name: 'Cost',
				type: 'number',
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
		mutationFn: () => {
			if (!state.jiraEmail || !state.jiraApiToken || !state.jiraBaseUrl) {
				throw new Error('Missing JIRA credentials or base URL');
			}
			return trpcClient.integrationsDiscovery.createJiraCustomField.mutate({
				email: state.jiraEmail,
				apiToken: state.jiraApiToken,
				baseUrl: state.jiraBaseUrl,
				name: 'Cost',
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
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handles two provider types + credential persisting
		mutationFn: async () => {
			let config: Record<string, unknown>;
			if (state.provider === 'trello') {
				config = {
					boardId: state.trelloBoardId,
					lists: state.trelloListMappings,
					labels: state.trelloLabelMappings,
					...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
				};
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
