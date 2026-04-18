/**
 * Linear ProviderWizardDefinition (plan 011/4).
 *
 * Migrated from per-provider step components to the shared step
 * components shipped by spec 010/3 + widened by plan 011/1. Every step
 * goes through the shared registry — Linear has no `kind: 'custom'`
 * steps (no OAuth popup, no issue-type mapping; credentials is a plain
 * single-role text input).
 *
 * Step sequence mirrors `linearManifest.wizardSpec.steps`:
 *   1. credentials                 — shared; single role (api_key)
 *   2. container-pick (searchable) — shared; team picker with type-ahead
 *   3. status-mapping              — shared; CASCADE stages → Linear workflow states (id-based)
 *   4. label-mapping (w/defaults)  — shared; curated labels + create affordance
 *   5. project-scope (searchable)  — shared; optional narrowing (spec 005)
 *   6. webhook-url-display         — shared; composed with ProjectSecretField
 *                                     for the LINEAR_WEBHOOK_SECRET (persistence
 *                                     is richer than the controlled-input
 *                                     pattern plan 011/1's widening assumed)
 */

import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { trpc } from '@/lib/trpc.js';
import { useLinearDiscovery, useLinearLabelCreation } from '../../pm-wizard-hooks.js';
import { buildLinearIntegrationConfig } from '../../pm-wizard-state.js';
import type { ProjectCredentialMeta } from '../../project-secret-field.js';
import { ContainerPickStep } from '../steps/container-pick.js';
import { CredentialsStep } from '../steps/credentials.js';
import { LabelMappingStep } from '../steps/label-mapping.js';
import { ProjectScopeStep } from '../steps/project-scope.js';
import { StatusMappingStep } from '../steps/status-mapping.js';
import type { ProviderWizardDefinition, ProviderWizardStepProps } from '../types.js';
import { LinearWebhookAdapter } from './webhook-step.js';

// CASCADE stage keys that map to Linear workflow state IDs (UUIDs —
// Linear's issue-update API requires state UUIDs, not names; the
// status-changed trigger does strict-equality matching on state IDs
// delivered in the webhook payload).
const LINEAR_STATUS_SLOTS = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'splitting', label: 'Splitting' },
	{ key: 'planning', label: 'Planning' },
	{ key: 'todo', label: 'Todo' },
	{ key: 'inProgress', label: 'In Progress' },
	{ key: 'inReview', label: 'In Review' },
	{ key: 'done', label: 'Done' },
	{ key: 'merged', label: 'Merged' },
] as const;

const LINEAR_LABEL_SLOTS = [
	{ key: 'readyToProcess', label: 'Ready to Process' },
	{ key: 'processing', label: 'Processing' },
	{ key: 'processed', label: 'Processed' },
	{ key: 'error', label: 'Error' },
	{ key: 'auto', label: 'Auto' },
] as const;

// Default CASCADE label names + hex colors for the shared Create
// affordance. Linear expects hex color strings on issueLabelCreate.
// Lives here after plan 011/5 deleted the legacy
// `pm-wizard-linear-steps.tsx` file.
const LINEAR_LABEL_DEFAULTS: Readonly<
	Record<string, { readonly name: string; readonly color: string }>
> = {
	readyToProcess: { name: 'cascade-ready', color: '#0284C7' },
	processing: { name: 'cascade-processing', color: '#2563EB' },
	processed: { name: 'cascade-processed', color: '#16A34A' },
	error: { name: 'cascade-error', color: '#DC2626' },
	auto: { name: 'cascade-auto', color: '#9333EA' },
};

const LINEAR_CREDENTIAL_ROLES = [{ role: 'api_key', label: 'API Key' }];

function isCredentialsComplete(state: {
	linearApiKey: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(state.linearApiKey && state.verificationResult);
}

interface LinearProviderHooks {
	readonly teamOptions: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly url?: string;
	}>;
	readonly teamsLoading: boolean;
	readonly teamsError: string | undefined;
	readonly onTeamSelect: (teamId: string) => void;
	readonly teamDetailsLoading: boolean;
	readonly providerStates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly providerLabels: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly color?: string;
	}>;
	readonly onCreateLabel: (slotKey: string, name: string, color?: string) => void;
	readonly projectOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly projectsLoading: boolean;
	readonly projectsError: string | undefined;
	readonly selectedProjectId: string | null;
	readonly onSelectProject: (projectId: string | null) => void;
	readonly webhookUrl: string;
	readonly projectIdForSecret: string;
	readonly webhookSecretCredential: ProjectCredentialMeta | undefined;
}

function asLinearHooks(providerHooks: Record<string, unknown> | undefined): LinearProviderHooks {
	return (providerHooks ?? {}) as unknown as LinearProviderHooks;
}

// ── Per-step adapters ────────────────────────────────────────────────

function LinearCredentialsAdapter({ state, dispatch }: ProviderWizardStepProps): ReactElement {
	return CredentialsStep({
		step: { kind: 'credentials', id: 'linear-credentials' },
		providerId: 'linear',
		credentialRoles: LINEAR_CREDENTIAL_ROLES,
		values: { api_key: state.linearApiKey },
		onChange: (role, value) => {
			if (role === 'api_key') dispatch({ type: 'SET_LINEAR_API_KEY', value });
		},
	});
}

function LinearTeamPickAdapter({ state, providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asLinearHooks(providerHooks);
	return ContainerPickStep({
		step: { kind: 'container-pick', id: 'linear-team' },
		providerId: 'linear',
		label: 'Select Team',
		options: h.teamOptions,
		selectedId: state.linearTeamId || null,
		onSelect: h.onTeamSelect,
		loading: h.teamsLoading,
		error: h.teamsError,
		searchable: true,
	});
}

function LinearStatusMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asLinearHooks(providerHooks);
	return StatusMappingStep({
		step: { kind: 'status-mapping', id: 'linear-statuses' },
		providerId: 'linear',
		cascadeStatuses: LINEAR_STATUS_SLOTS,
		providerStates: h.providerStates,
		mappings: state.linearStatusMappings,
		onMappingChange: (key, value) => dispatch({ type: 'SET_LINEAR_STATUS_MAPPING', key, value }),
		loading: h.teamDetailsLoading,
	});
}

function LinearLabelMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asLinearHooks(providerHooks);
	return LabelMappingStep({
		step: { kind: 'label-mapping', id: 'linear-labels' },
		providerId: 'linear',
		labelSlots: LINEAR_LABEL_SLOTS,
		providerLabels: h.providerLabels,
		mappings: state.linearLabels,
		onMappingChange: (key, value) => dispatch({ type: 'SET_LINEAR_LABEL', key, value }),
		onCreateLabel: h.onCreateLabel,
		labelDefaults: LINEAR_LABEL_DEFAULTS,
		loading: h.teamDetailsLoading,
	});
}

function LinearProjectScopeAdapter({ providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asLinearHooks(providerHooks);
	return ProjectScopeStep({
		step: { kind: 'project-scope', id: 'linear-project-scope' },
		providerId: 'linear',
		projects: h.projectOptions,
		selectedProjectId: h.selectedProjectId,
		onSelect: h.onSelectProject,
		loading: h.projectsLoading,
		error: h.projectsError,
		searchable: true,
	});
}

// Plan 012/3: the linear-webhook step's Component is now `LinearWebhookAdapter`
// (imported from `./webhook-step.js`) — a Fragment composing the shared
// WebhookUrlDisplayStep + info banner + 5-step setup instructions +
// ProjectSecretField for LINEAR_WEBHOOK_SECRET. Linear's API forbids
// programmatic webhook registration, so no Create/delete/curl UX.

export const linearProviderWizard: ProviderWizardDefinition = {
	id: 'linear',
	label: 'Linear',

	steps: [
		{
			id: 'linear-credentials',
			title: 'Linear credentials',
			Component: LinearCredentialsAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'linear-team',
			title: 'Team',
			Component: LinearTeamPickAdapter,
			isComplete: (state) => Boolean(state.linearTeamId),
		},
		{
			id: 'linear-statuses',
			title: 'Status mapping',
			Component: LinearStatusMappingAdapter,
			isComplete: (state) => Object.keys(state.linearStatusMappings).length > 0,
		},
		{
			id: 'linear-labels',
			title: 'Labels',
			Component: LinearLabelMappingAdapter,
			isComplete: () => true, // labels optional
		},
		{
			id: 'linear-project-scope',
			title: 'Project scope',
			Component: LinearProjectScopeAdapter,
			isComplete: () => true, // optional narrowing
		},
		{
			id: 'linear-webhook',
			title: 'Webhook',
			Component: LinearWebhookAdapter,
			isComplete: () => true,
		},
	],

	buildIntegrationConfig: buildLinearIntegrationConfig,

	isSetupComplete: (state) => {
		if (!state.linearTeamId) return false;
		if (Object.keys(state.linearStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		const discovery = useLinearDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const labels = useLinearLabelCreation(state, dispatch);
		// Lift the LINEAR_WEBHOOK_SECRET credential lookup from the parent
		// wizard (`pm-wizard.tsx`) into the provider hooks so the Linear
		// webhook step adapter can compose the shared `WebhookUrlDisplayStep`
		// with `ProjectSecretField` (self-managing persistence).
		const credentialsQuery = useQuery(
			trpc.projects.credentials.list.queryOptions({ projectId: projectId ?? '' }),
		);
		const webhookSecretCredential = credentialsQuery.data?.find(
			(c) => c.envVarKey === 'LINEAR_WEBHOOK_SECRET',
		);

		const [_creatingSlot, setCreatingSlot] = useState<string | null>(null);

		const onCreateLabel = (slot: string, name: string, color?: string) => {
			// If caller didn't supply a color, fall back to the canonical default.
			const resolvedColor = color ?? LINEAR_LABEL_DEFAULTS[slot]?.color ?? '#0284C7';
			setCreatingSlot(slot);
			labels.createLabelMutation.mutate(
				{ name, color: resolvedColor, slot },
				{ onSettled: () => setCreatingSlot(null) },
			);
		};

		const webhookUrl = projectId ? `${window.location.origin}/webhooks/${projectId}/linear` : '';

		const details = state.linearTeamDetails;

		return {
			teamOptions: state.linearTeams.map((t) => ({ id: t.id, name: t.name })),
			teamsLoading: discovery.linearTeamsMutation.isPending,
			teamsError: discovery.linearTeamsMutation.isError
				? (discovery.linearTeamsMutation.error as Error).message
				: undefined,
			onTeamSelect: discovery.handleTeamSelect,
			teamDetailsLoading: discovery.linearDetailsMutation.isPending,
			providerStates: details?.states ?? [],
			providerLabels: details?.labels ?? [],
			onCreateLabel,
			projectOptions: state.linearProjects.map((p) => ({ id: p.id, name: p.name })),
			projectsLoading: discovery.linearProjectsMutation.isPending,
			projectsError: discovery.linearProjectsMutation.isError
				? (discovery.linearProjectsMutation.error as Error).message
				: undefined,
			selectedProjectId: state.linearProjectId || null,
			onSelectProject: (v: string | null) =>
				dispatch({ type: 'SET_LINEAR_PROJECT_ID', value: v ?? '' }),
			webhookUrl,
			projectIdForSecret: projectId ?? '',
			webhookSecretCredential,
		} satisfies LinearProviderHooks & Record<string, unknown>;
	},
};
