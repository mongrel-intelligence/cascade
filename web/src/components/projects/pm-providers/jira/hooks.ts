import { useMutation } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useEffect } from 'react';
import { trpcClient } from '@/lib/trpc.js';
import { useProviderCustomFieldCreation } from '../../pm-wizard-hooks.js';
import type { WizardAction, WizardState } from '../../pm-wizard-state.js';
import type { ProviderAuthMetadata } from '../types.js';

// ============================================================================
// JIRA Discovery
// ============================================================================

export function useJiraDiscovery(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
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
					// Non-secret connection setting — routes discovery through the
					// correct host (site URL for basic, api.atlassian.com for scoped).
					auth_type: state.jiraAuthType,
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
				// Non-secret connection setting — routes project-details discovery
				// through the correct host (site URL for basic, gateway for scoped).
				authType: state.jiraAuthType,
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
// JIRA Custom Field Creation
// ============================================================================

export function useJiraCustomFieldCreation(
	providerId: string,
	auth: ProviderAuthMetadata,
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	const inner = useProviderCustomFieldCreation(
		{
			providerId,
			auth,
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
	// Preserve the legacy export name for JIRA callers.
	return { createJiraCustomFieldMutation: inner.createCustomFieldMutation };
}
