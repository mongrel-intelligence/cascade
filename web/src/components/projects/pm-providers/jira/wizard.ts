/**
 * JIRA ProviderWizardDefinition (plan 011/3).
 *
 * Migrated from per-provider step components to the shared step
 * components shipped by spec 010/3 + widened by plan 011/1. Every step
 * except the custom issue-type step now renders through the shared
 * generator's registry.
 *
 * Step sequence mirrors `jiraManifest.wizardSpec.steps`:
 *   1. credentials                 — shared; renders fields for base_url + email + api_token
 *   2. container-pick (searchable) — shared; project picker with type-ahead
 *   3. status-mapping              — shared; CASCADE stages → JIRA statuses (name-based)
 *   4. label-mapping (free-text)   — shared; no curated labels → text inputs
 *   5. custom-field-mapping        — shared; Cost custom field (global)
 *   6. custom(IssueTypeMappingStep)— JIRA-specific task/subtask mapping
 *   7. webhook-url-display         — shared
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createElement, type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { Label } from '@/components/ui/label.js';
import { API_URL } from '@/lib/api.js';
import type { DataProps } from '@/lib/data-props.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { buildMissingStatusTriggerConfigs } from '../save-trigger-configs.js';
import { ContainerPickStep } from '../steps/container-pick.js';
import { CredentialsStep } from '../steps/credentials.js';
import { CustomFieldMappingStep } from '../steps/custom-field-mapping.js';
import { LabelMappingStep } from '../steps/label-mapping.js';
import { StatusMappingStep } from '../steps/status-mapping.js';
import type { ProviderWizardDefinition, ProviderWizardStepProps } from '../types.js';
import { jiraAuthMetadata, jiraCredentialPersistence } from './auth.js';
import { useJiraCustomFieldCreation, useJiraDiscovery } from './hooks.js';
import { IssueTypeMappingStep } from './issue-type-step.js';
import { type JiraRoutingKind, RoutingStep } from './routing-step.js';
import type { JiraWizardAuthType } from './state.js';
import { JiraWebhookAdapter, normalizeJiraActiveWebhooks } from './webhook-step.js';

// CASCADE stage keys that map to JIRA statuses. MNG-1768: the mapping value
// persisted per slot is the locale-invariant JIRA status ID (name matching is
// retained only as a legacy fallback in the trigger/adapter), so status moves
// no longer silently no-op when the credential account's language differs from
// the site language.
export const JIRA_STATUS_SLOTS = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'splitting', label: 'Splitting' },
	{ key: 'planning', label: 'Planning' },
	{ key: 'todo', label: 'Todo' },
	{ key: 'inProgress', label: 'In Progress' },
	{ key: 'inReview', label: 'In Review' },
	{ key: 'done', label: 'Done' },
	{ key: 'merged', label: 'Merged' },
	{ key: 'alerts', label: 'Alerts' },
	{ key: 'friction', label: 'Friction' },
] as const;

// CASCADE labels that map to JIRA labels. JIRA labels are free-form
// strings (no curated enum), so the shared label-mapping step renders
// in free-text mode automatically when providerLabels is empty.
export const JIRA_LABEL_SLOTS = [
	{ key: 'readyToProcess', label: 'Ready to Process' },
	{ key: 'processing', label: 'Processing' },
	{ key: 'processed', label: 'Processed' },
	{ key: 'error', label: 'Error' },
	{ key: 'auto', label: 'Auto' },
	{ key: 'cascadeAlert', label: 'Cascade Alert' },
] as const;

const JIRA_CUSTOM_FIELD_SLOTS = [{ key: 'cost', label: 'Cost' }] as const;

// Credential roles the shared CredentialsStep renders. Includes base_url
// as a synthetic role — it's part of the integration config (not the
// provider-credential store) but needs a wizard input.
const JIRA_CREDENTIAL_ROLES = [
	{ role: 'base_url', label: 'Base URL' },
	{ role: 'email', label: 'Email' },
	{ role: 'api_token', label: 'API Token' },
];

function isCredentialsComplete(state: {
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(
		state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl && state.verificationResult,
	);
}

/**
 * Returns true when all required JIRA steps are done:
 * credentials + project selected + at least one status mapping.
 * Used to gate optional step `isComplete` predicates so they only show
 * green after the integration is actually configured.
 */
function areJiraRequiredStepsDone(
	state: Parameters<typeof isCredentialsComplete>[0] & {
		jiraProjectKey: string;
		jiraStatusMappings: Record<string, string>;
	},
): boolean {
	return (
		isCredentialsComplete(state) &&
		Boolean(state.jiraProjectKey) &&
		Object.keys(state.jiraStatusMappings).length > 0
	);
}

interface JiraProviderHooks {
	readonly projectOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly projectsLoading: boolean;
	readonly projectsError: string | undefined;
	readonly onProjectSelect: (projectKey: string) => void;
	readonly projectDetailsLoading: boolean;
	readonly providerStates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly providerCustomFields: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly type: string;
	}>;
	readonly issueTypes: ReadonlyArray<{ readonly name: string; readonly subtask: boolean }>;
	readonly onCreateCustomField: (slotKey: string, name: string) => void;
	readonly webhookUrl: string;
	// Plan 012/2 — webhook-step plumbing: programmatic Create + active list + delete.
	readonly callbackBaseUrl: string;
	readonly activeJiraWebhooks: ReadonlyArray<{
		readonly id: string;
		readonly url: string;
		readonly active: boolean;
	}>;
	readonly webhooksLoading: boolean;
	readonly createJiraWebhook: () => void;
	readonly createLoading: boolean;
	readonly createError: string | undefined;
	readonly deleteJiraWebhook: (callbackBaseUrl: string) => void;
	readonly deleteLoading: boolean;
	readonly workflowStatuses: ReadonlyArray<{ readonly key: string; readonly label: string }>;
}

function asJiraHooks(providerHooks: Record<string, unknown> | undefined): JiraProviderHooks {
	return (providerHooks ?? {}) as unknown as JiraProviderHooks;
}

// ── Per-step adapters ────────────────────────────────────────────────

// Basic vs scoped token selector options. Presented as a host-routing /
// security-scope choice, NOT a different auth protocol — the operator still
// enters email + API token in both modes (see MNG-1735 research).
const JIRA_AUTH_TYPE_OPTIONS: ReadonlyArray<{
	readonly value: JiraWizardAuthType;
	readonly label: string;
	readonly hint: string;
}> = [
	{
		value: 'basic',
		label: 'API token',
		hint: 'Classic API token. CASCADE calls the Jira REST API at your site URL.',
	},
	{
		value: 'scoped',
		label: 'API token with scopes',
		hint: 'Scoped API token — CASCADE routes Jira REST API calls through the api.atlassian.com gateway using the token’s granular scopes. You still enter your email + API token.',
	},
];

/**
 * Segmented control for the JIRA auth-type (basic vs scoped). Rendered via
 * shadcn `Button` primitives (SSR-safe; no raw radio/select) and dispatches
 * `SET_JIRA_AUTH_TYPE`. Shows the selected option's helper text below.
 */
function JiraAuthTypeSelector({
	value,
	onChange,
}: {
	value: JiraWizardAuthType;
	onChange: (next: JiraWizardAuthType) => void;
}): ReactElement {
	const activeHint = JIRA_AUTH_TYPE_OPTIONS.find((o) => o.value === value)?.hint ?? '';
	return createElement(
		'div',
		{ className: 'space-y-2', 'data-auth-type-selector': 'jira' },
		createElement(Label, null, 'Token type'),
		createElement(
			'div',
			{ className: 'flex gap-2', role: 'radiogroup', 'aria-label': 'JIRA token type' },
			...JIRA_AUTH_TYPE_OPTIONS.map((opt) =>
				createElement(
					Button,
					{
						key: opt.value,
						type: 'button',
						variant: value === opt.value ? 'default' : 'outline',
						size: 'sm',
						role: 'radio',
						'aria-checked': value === opt.value,
						'data-auth-type-option': opt.value,
						'data-selected': value === opt.value ? 'true' : 'false',
						onClick: () => onChange(opt.value),
					} as React.ComponentProps<typeof Button> & DataProps,
					opt.label,
				),
			),
		),
		createElement(
			'p',
			{ className: 'text-xs text-muted-foreground', 'data-auth-type-hint': value },
			activeHint,
		),
	);
}

function JiraCredentialsAdapter({ state, dispatch }: ProviderWizardStepProps): ReactElement {
	return createElement(
		'div',
		{ className: 'space-y-4' },
		JiraAuthTypeSelector({
			value: state.jiraAuthType,
			onChange: (value) => dispatch({ type: 'SET_JIRA_AUTH_TYPE', value }),
		}),
		CredentialsStep({
			step: { kind: 'credentials', id: 'jira-credentials' },
			providerId: 'jira',
			credentialRoles: JIRA_CREDENTIAL_ROLES,
			values: {
				base_url: state.jiraBaseUrl,
				email: state.jiraEmail,
				api_token: state.jiraApiToken,
			},
			onChange: (role, value) => {
				if (role === 'base_url') dispatch({ type: 'SET_JIRA_BASE_URL', url: value });
				else if (role === 'email') dispatch({ type: 'SET_JIRA_EMAIL', value });
				else if (role === 'api_token') dispatch({ type: 'SET_JIRA_API_TOKEN', value });
			},
		}),
	);
}

function JiraProjectPickAdapter({ state, providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asJiraHooks(providerHooks);
	return ContainerPickStep({
		step: { kind: 'container-pick', id: 'jira-project' },
		providerId: 'jira',
		label: 'Select Project',
		options: h.projectOptions,
		selectedId: state.jiraProjectKey || null,
		onSelect: h.onProjectSelect,
		loading: h.projectsLoading,
		error: h.projectsError,
		searchable: true,
	});
}

function JiraStatusMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asJiraHooks(providerHooks);
	return StatusMappingStep({
		step: { kind: 'status-mapping', id: 'jira-statuses' },
		providerId: 'jira',
		cascadeStatuses: h.workflowStatuses.length > 0 ? h.workflowStatuses : JIRA_STATUS_SLOTS,
		providerStates: h.providerStates,
		mappings: state.jiraStatusMappings,
		onMappingChange: (key, value) => dispatch({ type: 'SET_JIRA_STATUS_MAPPING', key, value }),
		loading: h.projectDetailsLoading,
	});
}

function JiraLabelMappingAdapter({ state, dispatch }: ProviderWizardStepProps): ReactElement {
	// JIRA labels are free-form; providerLabels is intentionally empty so
	// the shared component renders text inputs.
	return LabelMappingStep({
		step: { kind: 'label-mapping', id: 'jira-labels' },
		providerId: 'jira',
		labelSlots: JIRA_LABEL_SLOTS,
		providerLabels: [],
		mappings: state.jiraLabels,
		onMappingChange: (key, value) => dispatch({ type: 'SET_JIRA_LABEL', key, value }),
	});
}

function JiraCustomFieldMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asJiraHooks(providerHooks);
	return CustomFieldMappingStep({
		step: { kind: 'custom-field-mapping', id: 'jira-custom-fields' },
		providerId: 'jira',
		cascadeSlots: JIRA_CUSTOM_FIELD_SLOTS,
		providerCustomFields: h.providerCustomFields,
		mappings: { cost: state.jiraCostFieldId || undefined },
		onMappingChange: (key, value) => {
			if (key === 'cost') dispatch({ type: 'SET_JIRA_COST_FIELD', id: value });
		},
		onCreateCustomField: h.onCreateCustomField,
		fieldDefaults: { cost: { name: 'Cost' } },
		loading: h.projectDetailsLoading,
	});
}

function JiraIssueTypeAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asJiraHooks(providerHooks);
	return IssueTypeMappingStep({
		step: { kind: 'custom', id: 'jira-issue-types', component: 'IssueTypeMappingStep' },
		providerId: 'jira',
		issueTypes: h.issueTypes,
		mappings: state.jiraIssueTypes,
		onMappingChange: (key, value) => dispatch({ type: 'SET_JIRA_ISSUE_TYPE', key, value }),
		loading: h.projectDetailsLoading,
	});
}

function JiraRoutingAdapter({ state, dispatch }: ProviderWizardStepProps): ReactElement {
	// `selectedKind` is view state, not config: it keeps the value input mounted
	// while the box is empty, which the reducer treats as "no discriminator".
	const [selectedKind, setSelectedKind] = useState<JiraRoutingKind | undefined>(undefined);
	return RoutingStep({
		step: { kind: 'custom', id: 'jira-routing', component: 'RoutingStep' },
		providerId: 'jira',
		routingKind: state.jiraRoutingKind,
		routingValue: state.jiraRoutingValue,
		selectedKind,
		onSelectedKindChange: setSelectedKind,
		onRoutingChange: (kind: JiraRoutingKind, value: string) =>
			dispatch({ type: 'SET_JIRA_ROUTING_DISCRIMINATOR', kind, value }),
	});
}

// Plan 012/2: the jira-webhook step's Component is now `JiraWebhookAdapter`
// (imported from `./webhook-step.js`), a Fragment composing the shared
// WebhookUrlDisplayStep with JIRA-specific UX: active-webhooks list,
// programmatic Create button, delete buttons, curl fallback. The
// jiraEnsureLabels side-effect fires server-side inside
// `webhooks.create({ jiraOnly: true })`.

export const jiraProviderWizard: ProviderWizardDefinition = {
	id: 'jira',
	label: 'JIRA',
	auth: jiraAuthMetadata,
	formatVerificationDisplay: (me) => (me.displayName ? `${me.name} (${me.displayName})` : me.name),
	credentialPersistence: jiraCredentialPersistence,

	steps: [
		{
			id: 'jira-credentials',
			title: 'JIRA credentials',
			Component: JiraCredentialsAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'jira-project',
			title: 'Project',
			Component: JiraProjectPickAdapter,
			isComplete: (state) => Boolean(state.jiraProjectKey),
		},
		{
			id: 'jira-statuses',
			title: 'Status mapping',
			Component: JiraStatusMappingAdapter,
			isComplete: (state) => Object.keys(state.jiraStatusMappings).length > 0,
		},
		{
			id: 'jira-routing',
			title: 'Team routing',
			Component: JiraRoutingAdapter,
			// Always complete: sharing a board is opt-in, and a project that owns
			// its key outright is correctly configured with this left empty.
			isComplete: () => true,
		},
		{
			id: 'jira-labels',
			title: 'Labels',
			Component: JiraLabelMappingAdapter,
			isComplete: (state) => areJiraRequiredStepsDone(state), // optional, but only green after required steps
		},
		{
			id: 'jira-custom-fields',
			title: 'Custom fields',
			Component: JiraCustomFieldMappingAdapter,
			isComplete: (state) => areJiraRequiredStepsDone(state), // optional, but only green after required steps
		},
		{
			id: 'jira-issue-types',
			title: 'Issue types',
			Component: JiraIssueTypeAdapter,
			isComplete: (state) => areJiraRequiredStepsDone(state), // optional, but only green after required steps
		},
		{
			id: 'jira-webhook',
			title: 'Webhook',
			Component: JiraWebhookAdapter,
			isComplete: (state) => areJiraRequiredStepsDone(state),
		},
	],

	buildIntegrationConfig: (state) => ({
		projectKey: state.jiraProjectKey,
		baseUrl: state.jiraBaseUrl,
		// Non-secret connection setting persisted alongside baseUrl (mirrors the
		// backend jiraConfigSchema.authType). Later stories read it for host routing.
		authType: state.jiraAuthType,
		statuses: state.jiraStatusMappings,
		...(Object.keys(state.jiraIssueTypes).length > 0 ? { issueTypes: state.jiraIssueTypes } : {}),
		...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
		...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
		// Spec 024. Omitted entirely when unset so a project that does not share
		// a board saves a config byte-identical to before this plan — and so a
		// value set here is not silently dropped by the next save, which is the
		// bug that made the discriminator unconfigurable in practice.
		...(state.jiraRoutingKind && state.jiraRoutingValue
			? {
					routing: {
						discriminator: { kind: state.jiraRoutingKind, value: state.jiraRoutingValue },
					},
				}
			: {}),
	}),

	buildSaveTriggerConfigs: ({ state, workflowStatuses, existingConfigs }) =>
		buildMissingStatusTriggerConfigs({
			statusMappings: state.jiraStatusMappings,
			workflowStatuses,
			existingConfigs,
		}),

	buildEditState: (initialConfig, configuredKeys) => {
		const statuses = initialConfig.statuses as Record<string, string> | undefined;
		const issueTypes = initialConfig.issueTypes as Record<string, string> | undefined;
		const labels = initialConfig.labels as Record<string, string> | undefined;
		const discriminator = (
			initialConfig.routing as { discriminator?: { kind?: string; value?: string } } | undefined
		)?.discriminator;

		return {
			provider: 'jira',
			jiraBaseUrl: (initialConfig.baseUrl as string) ?? '',
			// Hydrate the persisted auth mode; legacy configs without authType
			// (saved before this field existed) default to 'basic'.
			jiraAuthType: (initialConfig.authType as JiraWizardAuthType | undefined) ?? 'basic',
			jiraProjectKey: (initialConfig.projectKey as string) ?? '',
			...(statuses ? { jiraStatusMappings: statuses } : {}),
			...(issueTypes ? { jiraIssueTypes: issueTypes } : {}),
			...(labels ? { jiraLabels: labels } : {}),
			jiraCostFieldId:
				(initialConfig.customFields as Record<string, string> | undefined)?.cost ?? '',
			jiraRoutingKind:
				discriminator?.kind === 'label' || discriminator?.kind === 'component'
					? discriminator.kind
					: '',
			jiraRoutingValue: discriminator?.value ?? '',
			hasStoredCredentials:
				configuredKeys.has('JIRA_EMAIL') && configuredKeys.has('JIRA_API_TOKEN'),
		};
	},

	isSetupComplete: (state) => {
		if (!state.jiraProjectKey) return false;
		if (Object.keys(state.jiraStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ providerId, auth, state, dispatch, projectId, advanceToStep }) => {
		const discovery = useJiraDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const customField = useJiraCustomFieldCreation(
			providerId,
			auth,
			state,
			dispatch,
			projectId ?? '',
		);
		const queryClient = useQueryClient();

		const onCreateCustomField = (_slotKey: string, name: string) => {
			customField.createJiraCustomFieldMutation.mutate({ name });
		};

		// Plan 012/2 — webhook plumbing. Mirrors the legacy `useWebhookManagement`
		// formula (plan 012/4 deletes that hook). The server-side
		// `jiraEnsureLabels` side-effect fires inside
		// `webhooks.create({ jiraOnly: true })` unchanged.
		const callbackBaseUrl =
			API_URL ||
			(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

		// Display the exact callback URL that actually gets registered — the
		// router route is `/jira/webhook`, not a synthetic
		// `/webhooks/<project>/jira` path the router never serves. The two had
		// diverged, so the displayed URL pointed operators at a dead endpoint.
		const webhookUrl = callbackBaseUrl ? `${callbackBaseUrl}/jira/webhook` : '';

		const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' }));
		const activeJiraWebhooks = normalizeJiraActiveWebhooks(webhooksQuery.data);

		// Load workflow status definitions so the status-mapping step can
		// render rows for custom statuses (e.g. `prd`) alongside the
		// built-in CASCADE stages. Falls back to `JIRA_STATUS_SLOTS` while
		// loading or when the query has no data.
		const workflowStatusesQuery = useQuery(trpc.workflowStatuses.list.queryOptions());

		const createWebhookMutation = useMutation({
			mutationFn: () =>
				trpcClient.webhooks.create.mutate({
					projectId: projectId ?? '',
					callbackBaseUrl,
					jiraOnly: true,
				}),
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' }).queryKey,
				});
			},
		});

		const deleteWebhookMutation = useMutation({
			mutationFn: (deleteBaseUrl: string) =>
				trpcClient.webhooks.delete.mutate({
					projectId: projectId ?? '',
					callbackBaseUrl: deleteBaseUrl,
					jiraOnly: true,
				}),
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' }).queryKey,
				});
			},
		});

		const details = state.jiraProjectDetails;

		return {
			projectOptions: state.jiraProjects.map((p) => ({ id: p.key, name: p.name })),
			projectsLoading: discovery.jiraProjectsMutation.isPending,
			projectsError: discovery.jiraProjectsMutation.isError
				? (discovery.jiraProjectsMutation.error as Error).message
				: undefined,
			onProjectSelect: discovery.handleProjectSelect,
			projectDetailsLoading: discovery.jiraDetailsMutation.isPending,
			// MNG-1768: the mapping value is the locale-invariant JIRA status ID
			// (`s.id`), while the human-readable `s.name` is what the select
			// displays. Previously both were `s.name`, which made status moves
			// locale-fragile.
			providerStates: (details?.statuses ?? []).map((s) => ({ id: s.id, name: s.name })),
			// JIRA's discovery returns `{id, name, custom}` for custom fields;
			// map `custom: boolean` to a string `type` to satisfy the shared
			// `providerCustomFields` prop contract.
			providerCustomFields: (details?.fields ?? []).map((f) => ({
				id: f.id,
				name: f.name,
				type: f.custom ? 'custom' : 'standard',
			})),
			issueTypes: details?.issueTypes ?? [],
			onCreateCustomField,
			webhookUrl,
			// Plan 012/2 — webhook plumbing consumed by `JiraWebhookAdapter`.
			callbackBaseUrl,
			activeJiraWebhooks,
			webhooksLoading: webhooksQuery.isLoading,
			createJiraWebhook: () => createWebhookMutation.mutate(),
			createLoading: createWebhookMutation.isPending,
			createError: createWebhookMutation.isError
				? (createWebhookMutation.error as Error).message
				: undefined,
			deleteJiraWebhook: (baseUrl: string) => deleteWebhookMutation.mutate(baseUrl),
			deleteLoading: deleteWebhookMutation.isPending,
			workflowStatuses:
				workflowStatusesQuery.data?.map((status) => ({
					key: status.key,
					label: status.label,
				})) ?? JIRA_STATUS_SLOTS,
		} satisfies JiraProviderHooks & Record<string, unknown>;
	},
};
