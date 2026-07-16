import { useMutation, useQuery } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useEffect, useMemo } from 'react';
import { trpcClient } from '@/lib/trpc.js';
import type {
	GitHubProjectsProjectOption,
	GitHubProjectsStatusOption,
	WizardAction,
	WizardState,
} from '../../pm-wizard-state.js';
import type { ProviderAuthMetadata } from '../types.js';

/**
 * Fetches the current GitHub user to populate the owner selection.
 * Uses the 'currentUser' discovery capability which returns the authenticated viewer.
 */
async function fetchCurrentUser(
	token: string | undefined,
	projectId: string,
	hasStoredCredentials: boolean,
): Promise<{ login: string; type: 'user' } | null> {
	// In edit mode with stored credentials but no token, use project-scoped discovery
	if (!token && hasStoredCredentials) {
		try {
			const result = (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'github-projects',
				capability: 'currentUser',
				args: {},
				projectId,
			})) as { id: string; name: string; displayName: string };
			return { login: result.displayName || result.name, type: 'user' };
		} catch {
			return null;
		}
	}

	// Otherwise use credential-based discovery
	if (!token) return null;
	try {
		const result = (await trpcClient.pm.discovery.discover.mutate({
			providerId: 'github-projects',
			capability: 'currentUser',
			args: {},
			credentials: { token },
		})) as { id: string; name: string; displayName: string };
		return { login: result.displayName || result.name, type: 'user' };
	} catch {
		return null;
	}
}

export function useGitHubProjectsDiscovery(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	advanceToStep: (step: number) => void,
	projectId: string,
) {
	const githubProjectsProjectsMutation = useMutation({
		mutationFn: async () => {
			if (state.isEditing && state.hasStoredCredentials && !state.githubProjectsToken) {
				return (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'github-projects',
					capability: 'projects',
					args: { containerId: `${state.githubProjectsOwner}:${state.githubProjectsOwnerType}` },
					projectId,
				})) as Array<{ id: string; name: string; url: string }>;
			}
			if (!state.githubProjectsToken) {
				throw new Error('Enter your GitHub token before fetching projects');
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'github-projects',
				capability: 'projects',
				args: { containerId: `${state.githubProjectsOwner}:${state.githubProjectsOwnerType}` },
				credentials: { token: state.githubProjectsToken },
			})) as Array<{ id: string; name: string; url: string }>;
		},
		onSuccess: (projects) =>
			dispatch({
				type: 'SET_GITHUB_PROJECTS_PROJECTS',
				projects: projects as GitHubProjectsProjectOption[],
			}),
	});

	const githubProjectsStatusesMutation = useMutation({
		mutationFn: async (projectIdArg: string) => {
			if (state.isEditing && state.hasStoredCredentials && !state.githubProjectsToken) {
				return (await trpcClient.pm.discovery.discover.mutate({
					providerId: 'github-projects',
					capability: 'states',
					args: { containerId: projectIdArg },
					projectId,
				})) as Array<{ id: string; name: string; category: string; color?: string }>;
			}
			if (!state.githubProjectsToken) {
				throw new Error('Enter your GitHub token before fetching statuses');
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'github-projects',
				capability: 'states',
				args: { containerId: projectIdArg },
				credentials: { token: state.githubProjectsToken },
			})) as Array<{ id: string; name: string; category: string; color?: string }>;
		},
		onSuccess: (statuses) => {
			dispatch({
				type: 'SET_GITHUB_PROJECTS_STATUS_OPTIONS',
				options: statuses as GitHubProjectsStatusOption[],
			});
			advanceToStep(4);
		},
	});

	const handleProjectSelect = (projectIdArg: string) => {
		dispatch({ type: 'SET_GITHUB_PROJECTS_PROJECT_ID', id: projectIdArg });
		if (projectIdArg) {
			githubProjectsStatusesMutation.mutate(projectIdArg);
		}
	};

	// Auto-fetch projects when verification succeeds or owner is selected.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification/owner change
	useEffect(() => {
		if (!state.verificationResult || state.provider !== 'github-projects') return;
		if (
			state.githubProjectsOwner &&
			state.githubProjectsProjects.length === 0 &&
			!githubProjectsProjectsMutation.isPending
		) {
			githubProjectsProjectsMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult, state.githubProjectsOwner]);

	// In edit mode, auto-fetch projects and statuses.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on edit mode and stored creds
	useEffect(() => {
		if (!state.isEditing || state.provider !== 'github-projects') return;
		const canFetch = state.githubProjectsToken ? true : state.hasStoredCredentials;
		if (
			state.githubProjectsOwner &&
			state.githubProjectsProjects.length === 0 &&
			canFetch &&
			!githubProjectsProjectsMutation.isPending
		) {
			githubProjectsProjectsMutation.mutate();
		}
		if (
			state.githubProjectsProjectId &&
			state.githubProjectsStatusOptions.length === 0 &&
			canFetch &&
			!githubProjectsStatusesMutation.isPending
		) {
			githubProjectsStatusesMutation.mutate(state.githubProjectsProjectId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.githubProjectsProjectId, state.hasStoredCredentials]);

	return {
		githubProjectsProjectsMutation,
		githubProjectsStatusesMutation,
		handleProjectSelect,
	};
}

export function useGitHubProjectsOwnerManagement(
	state: WizardState,
	dispatch: Dispatch<WizardAction>,
	projectId: string,
) {
	const { data: currentUser } = useQuery({
		queryKey: ['github-projects', 'currentUser', state.githubProjectsToken, projectId],
		queryFn: () =>
			fetchCurrentUser(state.githubProjectsToken, projectId, state.hasStoredCredentials),
		enabled:
			state.provider === 'github-projects' &&
			(Boolean(state.githubProjectsToken) || state.hasStoredCredentials),
	});

	const ownerOptions = useMemo(() => {
		if (currentUser) {
			return [{ login: currentUser.login, type: currentUser.type }];
		}
		// Fallback: if we have an owner already set in state, use that
		if (state.githubProjectsOwner) {
			return [{ login: state.githubProjectsOwner, type: state.githubProjectsOwnerType }];
		}
		return [];
	}, [currentUser, state.githubProjectsOwner, state.githubProjectsOwnerType]);

	const setOwner = (login: string, ownerType: 'user' | 'organization') => {
		dispatch({ type: 'SET_GITHUB_PROJECTS_OWNER', login, ownerType });
	};

	return {
		ownerOptions,
		setOwner,
	};
}

/**
 * Hook for label creation in GitHub Projects.
 *
 * @remarks
 * This is intentionally a no-op. GitHub Projects v2 does not support programmatic
 * label creation through the minimal integration. Labels in GitHub are managed
 * at the repository level, not the project level, and require different permissions.
 * This stub maintains API compatibility with other PM providers (Trello, JIRA, Linear)
 * that do support label creation.
 *
 * @param _providerId - Unused. The provider identifier ('github-projects').
 * @param _auth - Unused. Provider authentication metadata.
 * @param _state - Unused. Current wizard state.
 * @param _dispatch - Unused. State dispatch function.
 * @param _projectId - Unused. The project ID.
 * @returns Stub mutations that perform no operations.
 */
export function useGitHubProjectsLabelCreation(
	_providerId: string,
	_auth: ProviderAuthMetadata,
	_state: WizardState,
	_dispatch: Dispatch<WizardAction>,
	_projectId: string,
) {
	// Label creation is not supported for GitHub Projects in the minimal integration.
	// Labels in GitHub are repository-scoped and require different permissions than
	// project-scoped operations. This stub maintains API compatibility with other providers.
	return {
		createLabelMutation: { mutate: () => {}, isPending: false },
		createMissingLabelsMutation: { mutate: () => {}, isPending: false },
	};
}
