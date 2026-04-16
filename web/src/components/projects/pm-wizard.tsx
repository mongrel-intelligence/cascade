import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Globe, Loader2, XCircle } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
// Side-effect imports register every PM provider's frontend wizard into
// the provider registry. With Linear migrated (006/4), every PM provider
// now renders via the manifest shell.
import './pm-providers/trello/index.js';
import './pm-providers/jira/index.js';
import './pm-providers/linear/index.js';
import { ManifestProviderWizardSection } from './pm-providers/manifest-section.js';
import { getProviderWizard } from './pm-providers/registry.js';
import { SaveStep, WebhookStep } from './pm-wizard-common-steps.js';
import {
	useLinearWebhookInfo,
	useSaveMutation,
	useVerification,
	useWebhookManagement,
} from './pm-wizard-hooks.js';
// JIRA legacy step imports removed — all JIRA wizard rendering flows
// through the manifest path (see ./pm-providers/jira/). The
// `pm-wizard-jira-steps` module is still imported transitively by the
// adapters in `./pm-providers/jira/adapters.tsx`.
// Linear legacy step imports removed — all Linear wizard rendering flows
// through the manifest path (see ./pm-providers/linear/).
import {
	areCredentialsReady,
	buildEditState,
	createInitialState,
	deriveActiveWebhooks,
	isStep1Complete,
	isStep2Complete,
	isStep3Complete,
	isStep4Complete,
	wizardReducer,
} from './pm-wizard-state.js';
// Trello legacy step imports removed — all Trello wizard rendering flows
// through the manifest path (see ./pm-providers/trello/). The
// `pm-wizard-trello-steps` module is still imported transitively by the
// adapters in `./pm-providers/trello/adapters.tsx`, so its behavior is
// unchanged — only the per-provider branching in this file is gone.
import { WizardStep } from './wizard-shared.js';

// ============================================================================
// Constants
// ============================================================================

const STEP_TITLES = [
	'Provider',
	'Credentials & Verification',
	'Board / Project Selection',
	'Field Mapping',
	'Webhooks',
	'Save',
] as const;

const PROVIDER_LABELS: Record<'trello' | 'jira' | 'linear', string> = {
	trello: 'Trello',
	jira: 'JIRA',
	linear: 'Linear',
};

function confirmProviderSwitch(
	from: 'trello' | 'jira' | 'linear',
	to: 'trello' | 'jira' | 'linear',
): boolean {
	return window.confirm(
		`Switch PM provider from ${PROVIDER_LABELS[from]} to ${PROVIDER_LABELS[to]}?\n\nYou'll need to re-enter credentials and re-map fields for ${PROVIDER_LABELS[to]}. The old provider's credentials will be deleted when you save.`,
	);
}

// ============================================================================
// Main PMWizard Component
// ============================================================================

export function PMWizard({
	projectId,
	initialProvider,
	initialConfig,
}: {
	projectId: string;
	initialProvider: string;
	initialConfig?: Record<string, unknown>;
}) {
	const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId }));
	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));

	const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);
	const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
	// Provider-specific ephemeral state (creatingSlot, creatingCostField) now
	// lives inside each provider's useProviderHooks — Trello 006/2, JIRA
	// 006/3, Linear 006/4. The parent wizard no longer owns any.

	// ---- Step navigation helpers ----

	const toggleStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			if (next.has(step)) {
				next.delete(step);
			} else {
				next.add(step);
			}
			return next;
		});
	};

	const advanceToStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			next.add(step);
			return next;
		});
	};

	// ---- Initialize from existing integration ----

	const initializedRef = useRef(false);
	useEffect(() => {
		if (!initialConfig || !initialProvider || !credentialsQuery.data) return;
		if (initializedRef.current) return;
		initializedRef.current = true;
		const configuredKeys = new Set(credentialsQuery.data.map((c) => c.envVarKey));
		const editState = buildEditState(initialProvider, initialConfig, configuredKeys);
		dispatch({ type: 'INIT_EDIT', state: editState });
		setOpenSteps(new Set([1, 2, 3, 4, 5, 6]));
	}, [initialConfig, initialProvider, credentialsQuery.data]);

	// ---- Custom hooks ----

	// Is there a manifest-registered wizard for the active provider? If so,
	// ManifestProviderWizardSection drives the rendering (and runs the
	// provider's useProviderHooks internally). Unregistered providers fall
	// through to the legacy per-provider branches.
	const manifestDef = getProviderWizard(state.provider);

	const { verifyMutation } = useVerification(state, dispatch, advanceToStep);
	// Every PM provider (Trello 006/2, JIRA 006/3, Linear 006/4) composes its
	// discovery / label / custom-field hooks inside its own useProviderHooks.
	// The parent wizard no longer calls any provider-specific React hook.
	const webhookManagement = useWebhookManagement(projectId, state);
	const { webhookUrl: linearWebhookUrl } = useLinearWebhookInfo();
	const { saveMutation } = useSaveMutation(projectId, state);

	const linearWebhookSecretCredential = credentialsQuery.data?.find(
		(c) => c.envVarKey === 'LINEAR_WEBHOOK_SECRET',
	);

	// Label creation + discovery handlers now live inside each provider's
	// useProviderHooks (Trello 006/2, JIRA 006/3, Linear 006/4).

	// ---- Step status ----

	const credsReady = areCredentialsReady(state);

	function getStatus(
		stepNum: number,
		complete: boolean,
	): 'pending' | 'complete' | 'error' | 'active' {
		if (complete) return 'complete';
		if (openSteps.has(stepNum)) return 'active';
		return 'pending';
	}

	// ---- Active webhooks for this provider ----
	const activeWebhooks = deriveActiveWebhooks(state.provider, webhooksQuery.data);

	// ---- Render ----

	return (
		<div className="space-y-3">
			{/* Step 1: Provider */}
			<WizardStep
				stepNumber={1}
				title={STEP_TITLES[0]}
				status={getStatus(1, isStep1Complete(state))}
				isOpen={openSteps.has(1)}
				onToggle={() => toggleStep(1)}
			>
				<div className="space-y-2">
					<Label>Provider</Label>
					<div className="flex gap-2">
						{(['trello', 'jira', 'linear'] as const).map((p) => (
							<button
								key={p}
								type="button"
								onClick={() => {
									if (p === state.provider) return;
									if (state.isEditing && !confirmProviderSwitch(state.provider, p)) return;
									dispatch({ type: 'SET_PROVIDER', provider: p });
									advanceToStep(2);
								}}
								className={`flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
									state.provider === p
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50'
								}`}
							>
								{PROVIDER_LABELS[p]}
							</button>
						))}
					</div>
				</div>
			</WizardStep>

			{/* Step 2: Credentials & Verification */}
			<WizardStep
				stepNumber={2}
				title={STEP_TITLES[1]}
				status={getStatus(2, isStep2Complete(state))}
				isOpen={openSteps.has(2)}
				onToggle={() => toggleStep(2)}
			>
				{manifestDef && (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={0}
					/>
				)}

				<div className="flex items-center gap-3 pt-2">
					{(!state.isEditing || !state.hasStoredCredentials || credsReady) && (
						<button
							type="button"
							onClick={() => verifyMutation.mutate()}
							disabled={!credsReady || verifyMutation.isPending}
							className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{verifyMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Globe className="h-4 w-4" />
							)}
							Verify Connection
						</button>
					)}
					{state.verificationResult && (
						<div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
							<CheckCircle className="h-4 w-4" />
							Connected as <span className="font-medium">{state.verificationResult.display}</span>
						</div>
					)}
					{state.verifyError && (
						<div className="flex items-center gap-1.5 text-sm text-destructive">
							<XCircle className="h-4 w-4" />
							{state.verifyError}
						</div>
					)}
				</div>
			</WizardStep>

			{/* Step 3: Board / Project Selection */}
			<WizardStep
				stepNumber={3}
				title={STEP_TITLES[2]}
				status={getStatus(3, isStep3Complete(state))}
				isOpen={openSteps.has(3)}
				onToggle={() => toggleStep(3)}
			>
				{manifestDef && (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={1}
					/>
				)}
			</WizardStep>

			{/* Step 4: Field Mapping */}
			<WizardStep
				stepNumber={4}
				title={STEP_TITLES[3]}
				status={getStatus(4, isStep4Complete(state))}
				isOpen={openSteps.has(4)}
				onToggle={() => toggleStep(4)}
			>
				{manifestDef && (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={2}
					/>
				)}
			</WizardStep>

			{/* Step 5: Webhooks */}
			<WizardStep
				stepNumber={5}
				title={STEP_TITLES[4]}
				status={getStatus(5, true)}
				isOpen={openSteps.has(5)}
				onToggle={() => toggleStep(5)}
			>
				<WebhookStep
					state={state}
					webhooksQuery={webhooksQuery}
					activeWebhooks={activeWebhooks}
					linearWebhookUrl={linearWebhookUrl}
					projectId={projectId}
					linearWebhookSecretCredential={linearWebhookSecretCredential}
					{...webhookManagement}
				/>
			</WizardStep>

			{/* Step 6: Save */}
			<WizardStep
				stepNumber={6}
				title={STEP_TITLES[5]}
				status={getStatus(6, saveMutation.isSuccess)}
				isOpen={openSteps.has(6)}
				onToggle={() => toggleStep(6)}
			>
				<SaveStep state={state} saveMutation={saveMutation} />
			</WizardStep>
		</div>
	);
}
