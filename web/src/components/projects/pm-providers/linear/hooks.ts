import { useMutation } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useEffect } from 'react';
import { trpcClient } from '@/lib/trpc.js';
import { useProviderLabelCreation } from '../../pm-wizard-hooks.js';
import type {
	LinearProjectOption,
	LinearTeamDetails,
	LinearTeamOption,
	WizardAction,
	WizardState,
} from '../../pm-wizard-state.js';

// ============================================================================
// Linear Discovery
// ============================================================================

export function useLinearDiscovery(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
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

	// In edit mode, auto-fetch team list, details, and projects.
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
// Linear Label Creation
// ============================================================================

export function useLinearLabelCreation(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
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
