import { useMutation } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useEffect } from 'react';
import { trpcClient } from '@/lib/trpc.js';
import { useProviderCustomFieldCreation, useProviderLabelCreation } from '../../pm-wizard-hooks.js';
import type { WizardAction, WizardState } from '../../pm-wizard-state.js';
import { trelloAuthMetadata } from './auth.js';

// ============================================================================
// Trello Discovery
// ============================================================================

export function useTrelloDiscovery(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const boardsMutation = useMutation({
		mutationFn: async () => {
			// Plan 010/2: routes through generic pm.discovery.discover.
			// In edit mode with stored credentials, pass projectId; otherwise
			// pass raw credentials from wizard state.
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
// Trello Label Creation
// ============================================================================

export function useTrelloLabelCreation(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	return useProviderLabelCreation(
		{
			providerId: 'trello',
			auth: trelloAuthMetadata,
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
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	return useProviderCustomFieldCreation(
		{
			providerId: 'trello',
			auth: trelloAuthMetadata,
			getContainerId: (s) => s.trelloBoardId,
			containerError: 'Board must be selected before creating a custom field',
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
