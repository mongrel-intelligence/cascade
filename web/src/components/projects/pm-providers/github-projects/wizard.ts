/**
 * GitHub Projects ProviderWizardDefinition.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import type { ProjectCredentialMeta } from '../../project-secret-field.js';
import { buildMissingStatusTriggerConfigs } from '../save-trigger-configs.js';
import { ContainerPickStep } from '../steps/container-pick.js';
import { CredentialsStep } from '../steps/credentials.js';
import { ProjectScopeStep } from '../steps/project-scope.js';
import { StatusMappingStep } from '../steps/status-mapping.js';
import type { ProviderWizardDefinition, ProviderWizardStepProps } from '../types.js';
import { githubProjectsAuthMetadata, githubProjectsCredentialPersistence } from './auth.js';
import {
	useGitHubProjectsDiscovery,
	useGitHubProjectsLabelCreation,
	useGitHubProjectsOwnerManagement,
} from './hooks.js';
import {
	type ActiveWebhook,
	GitHubProjectsWebhookAdapter,
	normalizeGitHubProjectsActiveWebhooks,
} from './webhook-step.js';

export const GITHUB_PROJECTS_STATUS_SLOTS = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'todo', label: 'Todo' },
	{ key: 'inProgress', label: 'In Progress' },
	{ key: 'inReview', label: 'In Review' },
	{ key: 'done', label: 'Done' },
	{ key: 'merged', label: 'Merged' },
	{ key: 'alerts', label: 'Alerts' },
	{ key: 'friction', label: 'Friction' },
] as const;

const GITHUB_PROJECTS_CREDENTIAL_ROLES = [{ role: 'token', label: 'GitHub Personal Access Token' }];

function isCredentialsComplete(state: {
	githubProjectsToken: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(state.githubProjectsToken && state.verificationResult);
}

function areRequiredStepsDone(
	state: Parameters<typeof isCredentialsComplete>[0] & {
		githubProjectsProjectId: string;
		githubProjectsStatusMappings: Record<string, string>;
	},
): boolean {
	return (
		isCredentialsComplete(state) &&
		Boolean(state.githubProjectsProjectId) &&
		Object.keys(state.githubProjectsStatusMappings).length > 0
	);
}

interface GitHubProjectsProviderHooks {
	readonly projectOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly projectsLoading: boolean;
	readonly projectsError: string | undefined;
	readonly onProjectSelect: (projectId: string) => void;
	readonly statusOptionsLoading: boolean;
	readonly providerStates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly webhookUrl: string;
	readonly projectIdForSecret: string;
	readonly webhookSecretCredential: ProjectCredentialMeta | undefined;
	readonly workflowStatuses: ReadonlyArray<{ readonly key: string; readonly label: string }>;
	// Org-owned programmatic webhook management (consumed by GitHubProjectsWebhookAdapter).
	readonly callbackBaseUrl: string;
	readonly activeGithubProjectsWebhooks: ReadonlyArray<ActiveWebhook>;
	readonly webhooksLoading: boolean;
	readonly createGithubProjectsWebhook: () => void;
	readonly createLoading: boolean;
	readonly createError: string | undefined;
	readonly deleteGithubProjectsWebhook: (callbackBaseUrl: string) => void;
	readonly deleteLoading: boolean;
}

function asGitHubProjectsHooks(
	providerHooks: Record<string, unknown> | undefined,
): GitHubProjectsProviderHooks {
	return (providerHooks ?? {}) as unknown as GitHubProjectsProviderHooks;
}

function GitHubProjectsCredentialsAdapter({
	state,
	dispatch,
}: ProviderWizardStepProps): ReactElement {
	return CredentialsStep({
		step: { kind: 'credentials', id: 'github-projects-credentials' },
		providerId: 'github-projects',
		credentialRoles: GITHUB_PROJECTS_CREDENTIAL_ROLES,
		values: { token: state.githubProjectsToken },
		onChange: (role, value) => {
			if (role === 'token') dispatch({ type: 'SET_GITHUB_PROJECTS_TOKEN', value });
		},
	});
}

function GitHubProjectsScopeAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = providerHooks as { projectIdForSecret: string } | undefined;
	const { ownerOptions, setOwner } = useGitHubProjectsOwnerManagement(
		state,
		dispatch,
		h?.projectIdForSecret ?? '',
	);
	const selectedOwner = ownerOptions.find(
		(o) => o.login === state.githubProjectsOwner && o.type === state.githubProjectsOwnerType,
	);
	return ProjectScopeStep({
		step: { kind: 'project-scope', id: 'github-projects-scope' },
		providerId: 'github-projects',
		projects: ownerOptions.map((o) => ({
			id: `${o.login}:${o.type}`,
			name: `${o.login} (${o.type})`,
		})),
		selectedProjectId: selectedOwner ? `${selectedOwner.login}:${selectedOwner.type}` : null,
		onSelect: (v) => {
			if (!v) return;
			const [login, ownerType] = v.split(':') as [string, 'user' | 'organization'];
			setOwner(login, ownerType);
		},
		loading: false,
	});
}

function GitHubProjectsContainerPickAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asGitHubProjectsHooks(providerHooks);
	return ContainerPickStep({
		step: { kind: 'container-pick', id: 'github-projects-selection' },
		providerId: 'github-projects',
		label: 'Select Project',
		options: h.projectOptions,
		selectedId: state.githubProjectsProjectId || null,
		onSelect: (id) => {
			if (id) h.onProjectSelect(id);
			else dispatch({ type: 'SET_GITHUB_PROJECTS_PROJECT_ID', id: '' });
		},
		loading: h.projectsLoading,
		error: h.projectsError,
		searchable: true,
	});
}

function GitHubProjectsStatusMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asGitHubProjectsHooks(providerHooks);
	return StatusMappingStep({
		step: { kind: 'status-mapping', id: 'github-projects-statuses' },
		providerId: 'github-projects',
		cascadeStatuses:
			h.workflowStatuses.length > 0 ? h.workflowStatuses : GITHUB_PROJECTS_STATUS_SLOTS,
		providerStates: h.providerStates,
		mappings: state.githubProjectsStatusMappings,
		onMappingChange: (key, value) =>
			dispatch({ type: 'SET_GITHUB_PROJECTS_STATUS_MAPPING', key, value }),
		loading: h.statusOptionsLoading,
	});
}

export const githubProjectsProviderWizard: ProviderWizardDefinition = {
	id: 'github-projects',
	label: 'GitHub Projects',
	auth: githubProjectsAuthMetadata,
	formatVerificationDisplay: (me) => me.displayName || me.name,
	credentialPersistence: githubProjectsCredentialPersistence,

	steps: [
		{
			id: 'github-projects-credentials',
			title: 'GitHub credentials',
			Component: GitHubProjectsCredentialsAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'github-projects-scope',
			title: 'Owner',
			Component: GitHubProjectsScopeAdapter,
			isComplete: (state) => Boolean(state.githubProjectsOwner),
		},
		{
			id: 'github-projects-selection',
			title: 'Project',
			Component: GitHubProjectsContainerPickAdapter,
			isComplete: (state) => Boolean(state.githubProjectsProjectId),
		},
		{
			id: 'github-projects-statuses',
			title: 'Status mapping',
			Component: GitHubProjectsStatusMappingAdapter,
			isComplete: (state) => Object.keys(state.githubProjectsStatusMappings).length > 0,
		},
		{
			id: 'github-projects-webhook',
			title: 'Webhook',
			Component: GitHubProjectsWebhookAdapter,
			isComplete: (state) => areRequiredStepsDone(state),
		},
	],

	buildIntegrationConfig: (state) => ({
		projectId: state.githubProjectsProjectId,
		owner: state.githubProjectsOwner,
		ownerType: state.githubProjectsOwnerType,
		statuses: state.githubProjectsStatusMappings,
	}),

	buildSaveTriggerConfigs: ({ state, workflowStatuses, existingConfigs }) =>
		buildMissingStatusTriggerConfigs({
			statusMappings: state.githubProjectsStatusMappings,
			workflowStatuses,
			existingConfigs,
		}),

	buildEditState: (initialConfig, configuredKeys) => {
		const config = initialConfig as {
			projectId?: string;
			owner?: string;
			ownerType?: 'user' | 'organization';
			statuses?: Record<string, string>;
		};
		return {
			provider: 'github-projects',
			githubProjectsProjectId: config.projectId ?? '',
			githubProjectsOwner: config.owner ?? '',
			githubProjectsOwnerType: config.ownerType ?? 'user',
			...(config.statuses ? { githubProjectsStatusMappings: config.statuses } : {}),
			hasStoredCredentials: configuredKeys.has('GITHUB_PROJECTS_TOKEN'),
		};
	},

	isSetupComplete: (state) => {
		if (!state.githubProjectsProjectId) return false;
		if (Object.keys(state.githubProjectsStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ providerId, auth, state, dispatch, projectId, advanceToStep }) => {
		const discovery = useGitHubProjectsDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const labels = useGitHubProjectsLabelCreation(
			providerId,
			auth,
			state,
			dispatch,
			projectId ?? '',
		);
		const credentialsQuery = useQuery(
			trpc.projects.credentials.list.queryOptions({ projectId: projectId ?? '' }),
		);
		const workflowStatusesQuery = useQuery(trpc.workflowStatuses.list.queryOptions());
		const webhookSecretCredential = credentialsQuery.data?.find(
			(c) => c.envVarKey === 'GITHUB_PROJECTS_WEBHOOK_SECRET',
		);

		const routerOrigin =
			API_URL ||
			(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');
		const webhookUrl = routerOrigin ? `${routerOrigin}/github-projects/webhook` : '';

		// Programmatic org-webhook management (mirrors Trello/JIRA). The backend
		// no-ops for user-owned projects, so it's safe to always wire the hooks.
		const queryClient = useQueryClient();
		const callbackBaseUrl = routerOrigin;
		const webhooksListOptions = trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' });
		const webhooksQuery = useQuery({
			...webhooksListOptions,
			enabled: state.githubProjectsOwnerType === 'organization' && Boolean(projectId),
		});
		const activeGithubProjectsWebhooks = normalizeGitHubProjectsActiveWebhooks(webhooksQuery.data);
		// Carry the just-entered token so create works before it is persisted.
		const oneTimeTokens = state.githubProjectsToken
			? { githubProjectsToken: state.githubProjectsToken }
			: undefined;
		const invalidateWebhooks = () =>
			queryClient.invalidateQueries({ queryKey: webhooksListOptions.queryKey });
		const createWebhookMutation = useMutation({
			mutationFn: () =>
				trpcClient.webhooks.create.mutate({
					projectId: projectId ?? '',
					callbackBaseUrl,
					githubProjectsOnly: true,
					oneTimeTokens,
				}),
			onSuccess: invalidateWebhooks,
		});
		const deleteWebhookMutation = useMutation({
			mutationFn: (deleteBaseUrl: string) =>
				trpcClient.webhooks.delete.mutate({
					projectId: projectId ?? '',
					callbackBaseUrl: deleteBaseUrl,
					githubProjectsOnly: true,
					oneTimeTokens,
				}),
			onSuccess: invalidateWebhooks,
		});

		return {
			projectOptions: state.githubProjectsProjects.map((p) => ({ id: p.id, name: p.name })),
			projectsLoading: discovery.githubProjectsProjectsMutation.isPending,
			projectsError: discovery.githubProjectsProjectsMutation.isError
				? (discovery.githubProjectsProjectsMutation.error as Error).message
				: undefined,
			onProjectSelect: discovery.handleProjectSelect,
			statusOptionsLoading: discovery.githubProjectsStatusesMutation.isPending,
			providerStates: state.githubProjectsStatusOptions.map((s) => ({
				id: s.id,
				name: s.name,
			})),
			webhookUrl,
			projectIdForSecret: projectId ?? '',
			webhookSecretCredential,
			workflowStatuses:
				workflowStatusesQuery.data?.map((status) => ({
					key: status.key,
					label: status.label,
				})) ?? GITHUB_PROJECTS_STATUS_SLOTS,
			callbackBaseUrl,
			activeGithubProjectsWebhooks,
			webhooksLoading: webhooksQuery.isLoading,
			createGithubProjectsWebhook: () => createWebhookMutation.mutate(),
			createLoading: createWebhookMutation.isPending,
			createError: createWebhookMutation.isError
				? (createWebhookMutation.error as Error).message
				: undefined,
			deleteGithubProjectsWebhook: (baseUrl: string) => deleteWebhookMutation.mutate(baseUrl),
			deleteLoading: deleteWebhookMutation.isPending,
			...labels,
		} satisfies GitHubProjectsProviderHooks & Record<string, unknown>;
	},
};
