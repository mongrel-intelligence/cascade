import { useMutation, useQuery } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useEffect, useMemo } from 'react';
import { trpcClient } from '@/lib/trpc.js';
import type {
	GitHubProjectsStatusOption,
	WizardAction,
	WizardState,
} from '../../pm-wizard-state.js';
import type { ProviderAuthMetadata } from '../types.js';
import type { GitHubProjectsOwnerOption } from './state.js';

/** Shape returned by the `currentUser` discovery capability for github-projects. */
type CurrentUserDiscovery = {
	id: string;
	name: string;
	displayName?: string;
	login?: string;
	organizations?: Array<{ login: string }>;
};

/** The viewer identity + selectable org owners derived from a discovery result. */
interface OwnerViewer {
	login: string;
	organizations: string[];
}

/**
 * Reduce a `currentUser` discovery result to the owner login + the viewer's
 * organizations.
 *
 * The owner value MUST be the GitHub *login* (handle), never the display
 * `name`: owner/project discovery calls `user(login: …)`, which resolves to
 * `null` for any account whose profile name differs from its login (e.g. "Jane
 * Smith" vs `janesmith`) — breaking discovery. `name` is only a defensive
 * fallback for an older backend that predates the `login` field.
 */
export function toOwnerViewer(result: CurrentUserDiscovery): OwnerViewer | null {
	const login = result.login || result.name;
	if (!login) return null;
	return {
		login,
		organizations: (result.organizations ?? [])
			.map((o) => o.login)
			.filter((l): l is string => Boolean(l)),
	};
}

/**
 * Fetches the current GitHub user (and the organizations it belongs to) to
 * populate the owner selection. Uses the 'currentUser' discovery capability.
 */
async function fetchCurrentUser(
	token: string | undefined,
	projectId: string,
	hasStoredCredentials: boolean,
): Promise<OwnerViewer | null> {
	// In edit mode with stored credentials but no token, use project-scoped discovery
	if (!token && hasStoredCredentials) {
		try {
			const result = (await trpcClient.pm.discovery.discover.mutate({
				providerId: 'github-projects',
				capability: 'currentUser',
				args: {},
				projectId,
			})) as CurrentUserDiscovery;
			return toOwnerViewer(result);
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
		})) as CurrentUserDiscovery;
		return toOwnerViewer(result);
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
				// Discovery returns `{ id, name, url }` — structurally identical to
				// GitHubProjectsProjectOption, so no cast is needed (the `name` field
				// now lines up; the previous `as` cast masked a `title` mismatch).
				projects,
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

	const ownerOptions = useMemo<GitHubProjectsOwnerOption[]>(() => {
		const options: GitHubProjectsOwnerOption[] = [];
		if (currentUser) {
			// The viewer's personal account…
			options.push({ login: currentUser.login, type: 'user' });
			// …plus every organization they belong to, so org-owned projects
			// (whose webhook can be created programmatically) are selectable.
			for (const org of currentUser.organizations) {
				options.push({ login: org, type: 'organization' });
			}
		}
		// Fallback: preserve an owner already set in state (e.g. edit mode
		// hydrated from saved config, or an org not returned by discovery) so the
		// current selection still renders.
		if (
			state.githubProjectsOwner &&
			!options.some(
				(o) => o.login === state.githubProjectsOwner && o.type === state.githubProjectsOwnerType,
			)
		) {
			options.push({ login: state.githubProjectsOwner, type: state.githubProjectsOwnerType });
		}
		return options;
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
