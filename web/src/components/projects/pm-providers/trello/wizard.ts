/**
 * Trello ProviderWizardDefinition (plan 011/2).
 *
 * Migrated from per-provider step components to the shared step
 * components shipped by spec 010/3 + widened by plan 011/1. Every step
 * except the custom OAuth credentials step now renders through
 * `renderStandardStep` + `STANDARD_STEP_COMPONENTS`.
 *
 * Step sequence mirrors `trelloManifest.wizardSpec.steps`:
 *   1. custom(TrelloOAuthStep)     — OAuth popup + manual token fallback
 *   2. container-pick (searchable) — board picker with type-ahead
 *   3. status-mapping              — CASCADE stages → Trello lists
 *   4. label-mapping (w/defaults)  — CASCADE labels → Trello labels + create
 *   5. custom-field-mapping        — cost custom field + create
 *   6. webhook-url-display         — router URL + copy button
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { deriveActiveWebhooks } from '../../pm-wizard-state.js';
import { ContainerPickStep } from '../steps/container-pick.js';
import { CustomFieldMappingStep } from '../steps/custom-field-mapping.js';
import { LabelMappingStep } from '../steps/label-mapping.js';
import { StatusMappingStep } from '../steps/status-mapping.js';
import type { ProviderWizardDefinition, ProviderWizardStepProps } from '../types.js';
import { trelloAuthMetadata, trelloCredentialPersistence } from './auth.js';
import {
	useTrelloCustomFieldCreation,
	useTrelloDiscovery,
	useTrelloLabelCreation,
} from './hooks.js';
import { TrelloOAuthStep } from './oauth-step.js';
import { TrelloWebhookAdapter } from './webhook-step.js';

// CASCADE stage keys that map to Trello lists (one list per stage).
export const TRELLO_LIST_SLOTS = [
	{ key: 'backlog', label: 'Backlog' },
	{ key: 'splitting', label: 'Splitting' },
	{ key: 'planning', label: 'Planning' },
	{ key: 'todo', label: 'Todo' },
	{ key: 'inProgress', label: 'In Progress' },
	{ key: 'inReview', label: 'In Review' },
	{ key: 'done', label: 'Done' },
	{ key: 'merged', label: 'Merged' },
	{ key: 'debug', label: 'Debug' },
	{ key: 'alerts', label: 'Alerts' },
	{ key: 'friction', label: 'Friction' },
] as const;

// CASCADE labels that map to Trello labels. Defaults (name + color)
// pre-populate the shared `label-mapping` Create affordance and thread
// the color to `onCreateLabel(slot, name, color)`. Lives here after
// plan 011/5 deleted the legacy `pm-wizard-trello-steps.tsx` file.
const TRELLO_LABEL_DEFAULTS: Readonly<
	Record<string, { readonly name: string; readonly color: string }>
> = {
	readyToProcess: { name: 'cascade-ready', color: 'sky' },
	processing: { name: 'cascade-processing', color: 'blue' },
	processed: { name: 'cascade-processed', color: 'green' },
	error: { name: 'cascade-error', color: 'red' },
	auto: { name: 'cascade-auto', color: 'purple' },
	'cascade-alert': { name: 'cascade-alert', color: 'orange' },
};

export const TRELLO_LABEL_SLOTS = [
	{ key: 'readyToProcess', label: 'Ready to Process' },
	{ key: 'processing', label: 'Processing' },
	{ key: 'processed', label: 'Processed' },
	{ key: 'error', label: 'Error' },
	{ key: 'auto', label: 'Auto' },
	{ key: 'cascade-alert', label: 'Cascade Alert' },
] as const;

// Trello has one known custom-field slot: the cost estimate.
const TRELLO_CUSTOM_FIELD_SLOTS = [{ key: 'cost', label: 'Cost (number)' }] as const;

function isCredentialsComplete(state: {
	trelloApiKey: string;
	trelloToken: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(state.trelloApiKey && state.trelloToken && state.verificationResult);
}

/**
 * Returns true when all required Trello steps are done:
 * credentials + board selected + at least one list mapping.
 * Used to gate optional step `isComplete` predicates so they only show
 * green after the integration is actually configured.
 */
function areTrelloRequiredStepsDone(
	state: Parameters<typeof isCredentialsComplete>[0] & {
		trelloBoardId: string;
		trelloListMappings: Record<string, string>;
	},
): boolean {
	return (
		isCredentialsComplete(state) &&
		Boolean(state.trelloBoardId) &&
		Object.keys(state.trelloListMappings).length > 0
	);
}

/**
 * The shape returned by `useProviderHooks`. Each step adapter pulls the
 * slice it needs from this record. Ports all the mutations + memoized
 * callbacks that the legacy adapters consumed.
 */
interface TrelloProviderHooks {
	readonly boardOptions: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly url?: string;
	}>;
	readonly boardsLoading: boolean;
	readonly boardsError: string | undefined;
	readonly onBoardSelect: (boardId: string) => void;
	readonly boardDetailsLoading: boolean;
	readonly providerStates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	readonly providerLabels: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly color?: string;
	}>;
	readonly providerCustomFields: ReadonlyArray<{
		readonly id: string;
		readonly name: string;
		readonly type: string;
	}>;
	readonly onCreateLabel: (slotKey: string, name: string, color?: string) => void;
	readonly onCreateMissingLabels: (
		slots: ReadonlyArray<{ slot: string; name: string; color?: string }>,
	) => void;
	readonly creatingMissingLabels: boolean;
	readonly onCreateCustomField: (slotKey: string, name: string) => void;
	readonly webhookUrl: string;
	readonly creatingSlot: string | null;
	// Plan 012/1 — webhook-step plumbing: programmatic Create + active list + delete.
	readonly callbackBaseUrl: string;
	readonly activeTrelloWebhooks: ReadonlyArray<{
		readonly id: string;
		readonly url: string;
		readonly active: boolean;
	}>;
	readonly webhooksLoading: boolean;
	readonly createTrelloWebhook: () => void;
	readonly createLoading: boolean;
	readonly createError: string | undefined;
	readonly deleteTrelloWebhook: (callbackBaseUrl: string) => void;
	readonly deleteLoading: boolean;
}

function asTrelloHooks(providerHooks: Record<string, unknown> | undefined): TrelloProviderHooks {
	return (providerHooks ?? {}) as unknown as TrelloProviderHooks;
}

// ── Per-step adapters ────────────────────────────────────────────────
//
// Each adapter bridges `ProviderWizardStepProps` → the shared step's prop
// contract, pulling Trello-specific state off `providerHooks`.

function TrelloBoardPickAdapter({ state, providerHooks }: ProviderWizardStepProps): ReactElement {
	const h = asTrelloHooks(providerHooks);
	return ContainerPickStep({
		step: { kind: 'container-pick', id: 'trello-board' },
		providerId: 'trello',
		label: 'Select Board',
		options: h.boardOptions,
		selectedId: state.trelloBoardId || null,
		onSelect: h.onBoardSelect,
		loading: h.boardsLoading,
		error: h.boardsError,
		searchable: true,
	});
}

function TrelloStatusMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asTrelloHooks(providerHooks);
	return StatusMappingStep({
		step: { kind: 'status-mapping', id: 'trello-statuses' },
		providerId: 'trello',
		cascadeStatuses: TRELLO_LIST_SLOTS,
		providerStates: h.providerStates,
		mappings: state.trelloListMappings,
		onMappingChange: (key, value) => dispatch({ type: 'SET_TRELLO_LIST_MAPPING', key, value }),
		loading: h.boardDetailsLoading,
	});
}

function TrelloLabelMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asTrelloHooks(providerHooks);
	return LabelMappingStep({
		step: { kind: 'label-mapping', id: 'trello-labels' },
		providerId: 'trello',
		labelSlots: TRELLO_LABEL_SLOTS,
		providerLabels: h.providerLabels,
		mappings: state.trelloLabelMappings,
		onMappingChange: (key, value) => dispatch({ type: 'SET_TRELLO_LABEL_MAPPING', key, value }),
		onCreateLabel: h.onCreateLabel,
		onCreateMissingLabels: h.onCreateMissingLabels,
		creatingMissing: h.creatingMissingLabels,
		labelDefaults: TRELLO_LABEL_DEFAULTS,
		loading: h.boardDetailsLoading,
	});
}

function TrelloCustomFieldMappingAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps): ReactElement {
	const h = asTrelloHooks(providerHooks);
	return CustomFieldMappingStep({
		step: { kind: 'custom-field-mapping', id: 'trello-custom-fields' },
		providerId: 'trello',
		cascadeSlots: TRELLO_CUSTOM_FIELD_SLOTS,
		providerCustomFields: h.providerCustomFields,
		mappings: { cost: state.trelloCostFieldId || undefined },
		onMappingChange: (key, value) => {
			if (key === 'cost') dispatch({ type: 'SET_TRELLO_COST_FIELD', id: value });
		},
		onCreateCustomField: h.onCreateCustomField,
		fieldDefaults: { cost: { name: 'Cost' } },
		loading: h.boardDetailsLoading,
	});
}

// Plan 012/1: the trello-webhook step's Component is now `TrelloWebhookAdapter`
// (imported from `./webhook-step.js`), a Fragment composing the shared
// WebhookUrlDisplayStep with Trello-specific UX: active-webhooks list,
// programmatic Create button, delete buttons, curl fallback.

export const trelloProviderWizard: ProviderWizardDefinition = {
	id: 'trello',
	label: 'Trello',
	auth: trelloAuthMetadata,
	formatVerificationDisplay: (me) => (me.displayName ? `@${me.displayName} (${me.name})` : me.name),
	credentialPersistence: trelloCredentialPersistence,

	// Each step mirrors `trelloManifest.wizardSpec.steps` by id.
	steps: [
		{
			id: 'trello-credentials-oauth',
			title: 'Trello credentials',
			Component: TrelloOAuthStep,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'trello-board',
			title: 'Board',
			Component: TrelloBoardPickAdapter,
			isComplete: (state) => Boolean(state.trelloBoardId),
		},
		{
			id: 'trello-statuses',
			title: 'Status mapping',
			Component: TrelloStatusMappingAdapter,
			isComplete: (state) => Object.keys(state.trelloListMappings).length > 0,
		},
		{
			id: 'trello-labels',
			title: 'Label mapping',
			Component: TrelloLabelMappingAdapter,
			isComplete: (state) => areTrelloRequiredStepsDone(state), // optional, but only green after required steps
		},
		{
			id: 'trello-custom-fields',
			title: 'Custom fields',
			Component: TrelloCustomFieldMappingAdapter,
			isComplete: (state) => areTrelloRequiredStepsDone(state), // optional, but only green after required steps
		},
		{
			id: 'trello-webhook',
			title: 'Webhook',
			Component: TrelloWebhookAdapter,
			isComplete: (state) => areTrelloRequiredStepsDone(state),
		},
	],

	buildIntegrationConfig: (state) => ({
		boardId: state.trelloBoardId,
		lists: state.trelloListMappings,
		labels: state.trelloLabelMappings,
		...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
	}),

	isSetupComplete: (state) => {
		if (!state.trelloBoardId) return false;
		if (Object.keys(state.trelloListMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		const discovery = useTrelloDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const labels = useTrelloLabelCreation(state, dispatch, projectId ?? '');
		const customField = useTrelloCustomFieldCreation(state, dispatch, projectId ?? '');
		const queryClient = useQueryClient();

		const [creatingSlot, setCreatingSlot] = useState<string | null>(null);

		const onCreateLabel = (slot: string, name: string, color?: string) => {
			// If caller didn't supply a color, fall back to the canonical default.
			const resolvedColor = color ?? TRELLO_LABEL_DEFAULTS[slot]?.color ?? 'sky';
			setCreatingSlot(slot);
			labels.createLabelMutation.mutate(
				{ name, color: resolvedColor, slot },
				{ onSettled: () => setCreatingSlot(null) },
			);
		};

		const onCreateMissingLabels = (
			slots: ReadonlyArray<{ slot: string; name: string; color?: string }>,
		) => {
			const resolved = slots.map((s) => ({
				slot: s.slot,
				name: s.name,
				color: s.color ?? TRELLO_LABEL_DEFAULTS[s.slot]?.color ?? 'sky',
			}));
			labels.createMissingLabelsMutation.mutate(resolved);
		};

		const onCreateCustomField = (_slotKey: string, name: string) => {
			customField.createCustomFieldMutation.mutate({ name });
		};

		const webhookUrl = projectId ? `${window.location.origin}/webhooks/${projectId}/trello` : '';

		// Plan 012/1 — webhook plumbing. Mirrors the legacy `useWebhookManagement`
		// formula (plan 012/4 deletes that hook). Computes the public router URL
		// from the Vite env (dev) or current origin (prod), fetches active
		// webhooks via `trpc.webhooks.list`, wraps create/delete mutations with
		// `trelloOnly: true`.
		const callbackBaseUrl =
			API_URL ||
			(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

		const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' }));
		const activeTrelloWebhooks = deriveActiveWebhooks('trello', webhooksQuery.data) as Array<{
			id: string;
			url: string;
			active: boolean;
		}>;

		const createWebhookMutation = useMutation({
			mutationFn: () =>
				trpcClient.webhooks.create.mutate({
					projectId: projectId ?? '',
					callbackBaseUrl,
					trelloOnly: true,
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
					trelloOnly: true,
				}),
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.webhooks.list.queryOptions({ projectId: projectId ?? '' }).queryKey,
				});
			},
		});

		const boardDetails = state.trelloBoardDetails;

		return {
			boardOptions: state.trelloBoards,
			boardsLoading: discovery.boardsMutation.isPending,
			boardsError: discovery.boardsMutation.isError
				? (discovery.boardsMutation.error as Error).message
				: undefined,
			onBoardSelect: discovery.handleBoardSelect,
			boardDetailsLoading: discovery.boardDetailsMutation.isPending,
			providerStates: boardDetails?.lists ?? [],
			providerLabels: boardDetails?.labels ?? [],
			providerCustomFields: boardDetails?.customFields.filter((f) => f.type === 'number') ?? [],
			onCreateLabel,
			onCreateMissingLabels,
			creatingMissingLabels: labels.createMissingLabelsMutation.isPending,
			onCreateCustomField,
			webhookUrl,
			creatingSlot,
			// Exposed for any caller that wants to render a secondary
			// loading indicator near the board-picker step.
			boardDetailsLoadingIcon: Loader2,
			// Plan 012/1 — webhook plumbing consumed by `TrelloWebhookAdapter`.
			callbackBaseUrl,
			activeTrelloWebhooks,
			webhooksLoading: webhooksQuery.isLoading,
			createTrelloWebhook: () => createWebhookMutation.mutate(),
			createLoading: createWebhookMutation.isPending,
			createError: createWebhookMutation.isError
				? (createWebhookMutation.error as Error).message
				: undefined,
			deleteTrelloWebhook: (baseUrl: string) => deleteWebhookMutation.mutate(baseUrl),
			deleteLoading: deleteWebhookMutation.isPending,
		} satisfies TrelloProviderHooks & Record<string, unknown>;
	},
};
