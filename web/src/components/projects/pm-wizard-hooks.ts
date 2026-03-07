/**
 * Custom hooks for PM Wizard mutations and side-effects.
 * Each hook encapsulates one concern to keep the main orchestrator thin.
 */
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { WizardAction, WizardState } from './pm-wizard-state.js';

// ============================================================================
// Trello Discovery
// ============================================================================

export function useTrelloDiscovery(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const boardsMutation = useMutation({
		mutationFn: () => {
			if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
				throw new Error('Select both credentials before fetching boards');
			}
			return trpcClient.integrationsDiscovery.trelloBoards.mutate({
				apiKeyCredentialId: state.trelloApiKeyCredentialId,
				tokenCredentialId: state.trelloTokenCredentialId,
			});
		},
		onSuccess: (boards) => dispatch({ type: 'SET_TRELLO_BOARDS', boards }),
	});

	const boardDetailsMutation = useMutation({
		mutationFn: (boardId: string) => {
			if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
				throw new Error('Select both credentials before fetching board details');
			}
			return trpcClient.integrationsDiscovery.trelloBoardDetails.mutate({
				apiKeyCredentialId: state.trelloApiKeyCredentialId,
				tokenCredentialId: state.trelloTokenCredentialId,
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on edit mode state changes
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'trello') return;

		if (
			state.trelloApiKeyCredentialId &&
			state.trelloTokenCredentialId &&
			state.trelloBoards.length === 0 &&
			!boardsMutation.isPending
		) {
			boardsMutation.mutate();
		}
		if (
			state.trelloBoardId &&
			!state.trelloBoardDetails &&
			state.trelloApiKeyCredentialId &&
			state.trelloTokenCredentialId &&
			!boardDetailsMutation.isPending
		) {
			boardDetailsMutation.mutate(state.trelloBoardId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.trelloBoardId]);

	return { boardsMutation, boardDetailsMutation, handleBoardSelect };
}

// ============================================================================
// JIRA Discovery
// ============================================================================

export function useJiraDiscovery(
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
) {
	const jiraProjectsMutation = useMutation({
		mutationFn: () => {
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before fetching projects');
			}
			return trpcClient.integrationsDiscovery.jiraProjects.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
				baseUrl: state.jiraBaseUrl,
			});
		},
		onSuccess: (projects) => dispatch({ type: 'SET_JIRA_PROJECTS', projects }),
	});

	const jiraDetailsMutation = useMutation({
		mutationFn: (projectKey: string) => {
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before fetching project details');
			}
			return trpcClient.integrationsDiscovery.jiraProjectDetails.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on edit mode state changes
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'jira') return;

		if (
			state.jiraEmailCredentialId &&
			state.jiraApiTokenCredentialId &&
			state.jiraProjects.length === 0 &&
			!jiraProjectsMutation.isPending
		) {
			jiraProjectsMutation.mutate();
		}
		if (
			state.jiraProjectKey &&
			!state.jiraProjectDetails &&
			state.jiraEmailCredentialId &&
			state.jiraApiTokenCredentialId &&
			!jiraDetailsMutation.isPending
		) {
			jiraDetailsMutation.mutate(state.jiraProjectKey);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.jiraProjectKey]);

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
				if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
					throw new Error('Select both credentials before verifying');
				}
				const result = await trpcClient.integrationsDiscovery.verifyTrello.mutate({
					apiKeyCredentialId: state.trelloApiKeyCredentialId,
					tokenCredentialId: state.trelloTokenCredentialId,
				});
				return { provider: 'trello' as const, result };
			}
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before verifying');
			}
			const result = await trpcClient.integrationsDiscovery.verifyJira.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
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

	const [adminTokensOpen, setAdminTokensOpen] = useState(false);
	const [oneTimeTrelloApiKey, setOneTimeTrelloApiKey] = useState('');
	const [oneTimeTrelloToken, setOneTimeTrelloToken] = useState('');
	const [oneTimeJiraEmail, setOneTimeJiraEmail] = useState('');
	const [oneTimeJiraApiToken, setOneTimeJiraApiToken] = useState('');

	const buildOneTimeTokens = () => {
		const tokens: Record<string, string> = {};
		if (oneTimeTrelloApiKey) tokens.trelloApiKey = oneTimeTrelloApiKey;
		if (oneTimeTrelloToken) tokens.trelloToken = oneTimeTrelloToken;
		if (oneTimeJiraEmail) tokens.jiraEmail = oneTimeJiraEmail;
		if (oneTimeJiraApiToken) tokens.jiraApiToken = oneTimeJiraApiToken;
		return Object.keys(tokens).length > 0 ? tokens : undefined;
	};

	const clearOneTimeTokens = () => {
		setOneTimeTrelloApiKey('');
		setOneTimeTrelloToken('');
		setOneTimeJiraEmail('');
		setOneTimeJiraApiToken('');
	};

	const createWebhookMutation = useMutation({
		mutationFn: () =>
			trpcClient.webhooks.create.mutate({
				projectId,
				callbackBaseUrl,
				trelloOnly: state.provider === 'trello' ? true : undefined,
				jiraOnly: state.provider === 'jira' ? true : undefined,
				oneTimeTokens: buildOneTimeTokens(),
			}),
		onSuccess: () => {
			clearOneTimeTokens();
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
				oneTimeTokens: buildOneTimeTokens(),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return {
		callbackBaseUrl,
		adminTokensOpen,
		setAdminTokensOpen,
		oneTimeTrelloApiKey,
		setOneTimeTrelloApiKey,
		oneTimeTrelloToken,
		setOneTimeTrelloToken,
		oneTimeJiraEmail,
		setOneTimeJiraEmail,
		oneTimeJiraApiToken,
		setOneTimeJiraApiToken,
		createWebhookMutation,
		deleteWebhookMutation,
	};
}

// ============================================================================
// Save Mutation
// ============================================================================

export function useSaveMutation(projectId: string, state: WizardState) {
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handles two provider types + credential linking
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

			// Set credentials
			const credPairs: Array<{ role: string; credentialId: number }> =
				state.provider === 'trello'
					? [
							...(state.trelloApiKeyCredentialId
								? [{ role: 'api_key', credentialId: state.trelloApiKeyCredentialId }]
								: []),
							...(state.trelloTokenCredentialId
								? [{ role: 'token', credentialId: state.trelloTokenCredentialId }]
								: []),
						]
					: [
							...(state.jiraEmailCredentialId
								? [{ role: 'email', credentialId: state.jiraEmailCredentialId }]
								: []),
							...(state.jiraApiTokenCredentialId
								? [{ role: 'api_token', credentialId: state.jiraApiTokenCredentialId }]
								: []),
						];

			for (const { role, credentialId } of credPairs) {
				await trpcClient.projects.integrationCredentials.set.mutate({
					projectId,
					category: 'pm',
					role,
					credentialId,
				});
			}

			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrationCredentials.list.queryOptions({
					projectId,
					category: 'pm',
				}).queryKey,
			});
		},
	});

	return { saveMutation };
}
