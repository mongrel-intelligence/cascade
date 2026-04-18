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

import type { ReactElement } from 'react';
import { useJiraCustomFieldCreation, useJiraDiscovery } from '../../pm-wizard-hooks.js';
import { ContainerPickStep } from '../steps/container-pick.js';
import { CredentialsStep } from '../steps/credentials.js';
import { CustomFieldMappingStep } from '../steps/custom-field-mapping.js';
import { LabelMappingStep } from '../steps/label-mapping.js';
import { StatusMappingStep } from '../steps/status-mapping.js';
import { WebhookUrlDisplayStep } from '../steps/webhook-url-display.js';
import type { ProviderWizardDefinition, ProviderWizardStepProps } from '../types.js';
import { IssueTypeMappingStep } from './issue-type-step.js';

// CASCADE stage keys that map to JIRA statuses (name-based, not id-based
// — JIRA statuses are configured per project, name is the stable identity).
const JIRA_STATUS_SLOTS = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'splitting', label: 'Splitting' },
	{ key: 'planning', label: 'Planning' },
	{ key: 'todo', label: 'Todo' },
	{ key: 'inProgress', label: 'In Progress' },
	{ key: 'inReview', label: 'In Review' },
	{ key: 'done', label: 'Done' },
	{ key: 'merged', label: 'Merged' },
] as const;

// CASCADE labels that map to JIRA labels. JIRA labels are free-form
// strings (no curated enum), so the shared label-mapping step renders
// in free-text mode automatically when providerLabels is empty.
const JIRA_LABEL_SLOTS = [
	{ key: 'readyToProcess', label: 'Ready to Process' },
	{ key: 'processing', label: 'Processing' },
	{ key: 'processed', label: 'Processed' },
	{ key: 'error', label: 'Error' },
	{ key: 'auto', label: 'Auto' },
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
}

function asJiraHooks(providerHooks: Record<string, unknown> | undefined): JiraProviderHooks {
	return (providerHooks ?? {}) as unknown as JiraProviderHooks;
}

// ── Per-step adapters ────────────────────────────────────────────────

function JiraCredentialsAdapter({ state, dispatch }: ProviderWizardStepProps): ReactElement {
	return CredentialsStep({
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
	});
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
		cascadeStatuses: JIRA_STATUS_SLOTS,
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

function JiraWebhookDisplayAdapter({ providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asJiraHooks(providerHooks);
	return WebhookUrlDisplayStep({
		step: {
			kind: 'webhook-url-display',
			id: 'jira-webhook',
			config: {
				instructions:
					'In JIRA Automation or a custom webhook configuration, post issue events to this URL.',
			},
		},
		providerId: 'jira',
		webhookUrl: h.webhookUrl,
	});
}

export const jiraProviderWizard: ProviderWizardDefinition = {
	id: 'jira',
	label: 'JIRA',

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
			id: 'jira-labels',
			title: 'Labels',
			Component: JiraLabelMappingAdapter,
			isComplete: () => true, // labels are optional
		},
		{
			id: 'jira-custom-fields',
			title: 'Custom fields',
			Component: JiraCustomFieldMappingAdapter,
			isComplete: () => true, // cost field optional
		},
		{
			id: 'jira-issue-types',
			title: 'Issue types',
			Component: JiraIssueTypeAdapter,
			isComplete: () => true, // issue-type mapping optional
		},
		{
			id: 'jira-webhook',
			title: 'Webhook',
			Component: JiraWebhookDisplayAdapter,
			isComplete: () => true,
		},
	],

	buildIntegrationConfig: (state) => ({
		projectKey: state.jiraProjectKey,
		baseUrl: state.jiraBaseUrl,
		statuses: state.jiraStatusMappings,
		...(Object.keys(state.jiraIssueTypes).length > 0 ? { issueTypes: state.jiraIssueTypes } : {}),
		...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
		...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
	}),

	isSetupComplete: (state) => {
		if (!state.jiraProjectKey) return false;
		if (Object.keys(state.jiraStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		const discovery = useJiraDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const customField = useJiraCustomFieldCreation(state, dispatch);

		const onCreateCustomField = (_slotKey: string, name: string) => {
			customField.createJiraCustomFieldMutation.mutate({ name });
		};

		const webhookUrl = projectId ? `${window.location.origin}/webhooks/${projectId}/jira` : '';

		const details = state.jiraProjectDetails;

		return {
			projectOptions: state.jiraProjects.map((p) => ({ id: p.key, name: p.name })),
			projectsLoading: discovery.jiraProjectsMutation.isPending,
			projectsError: discovery.jiraProjectsMutation.isError
				? (discovery.jiraProjectsMutation.error as Error).message
				: undefined,
			onProjectSelect: discovery.handleProjectSelect,
			projectDetailsLoading: discovery.jiraDetailsMutation.isPending,
			// JIRA statuses carry a `name` used as the id in mappings (JIRA's
			// status-name is the stable identity the adapter writes back).
			providerStates: (details?.statuses ?? []).map((s) => ({ id: s.name, name: s.name })),
			providerCustomFields: details?.fields ?? [],
			issueTypes: details?.issueTypes ?? [],
			onCreateCustomField,
			webhookUrl,
		} satisfies JiraProviderHooks & Record<string, unknown>;
	},
};
