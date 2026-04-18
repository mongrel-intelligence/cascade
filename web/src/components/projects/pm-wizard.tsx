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
// Plan 011/5: the three legacy `pm-wizard-{trello,jira,linear}-steps.tsx`
// files were deleted; all three providers now render exclusively through
// the manifest path (see `./pm-providers/<provider>/wizard.ts`).
import {
	areCredentialsReady,
	buildEditState,
	createInitialState,
	deriveActiveWebhooks,
	isStep1Complete,
	wizardReducer,
} from './pm-wizard-state.js';
import { WizardStep } from './wizard-shared.js';

// ============================================================================
// Constants
// ============================================================================

// Plan 011/4: step titles now come from each provider's wizard definition
// (manifestDef.steps[i].title). Only step 1 (provider picker) and the
// legacy Webhook + Save slots have fixed titles; rendered inline.

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
		// Plan 011/4: open all steps up to a comfortable ceiling; actual
		// step count is provider-dependent (Trello 7, JIRA 8, Linear 7).
		setOpenSteps(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
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

	// ---- Manifest step layout (plans 011/4 + 012/1-2) ----
	// Iterate over `manifestDef.steps`. The legacy `WebhookStep` below
	// still owns webhook UX for providers that haven't been migrated yet.
	// Plans 012/1-2 migrated Trello + JIRA; Linear still routes through legacy.
	// Plan 012/3 migrates Linear; plan 012/4 deletes the filter entirely.
	const renderedManifestSteps = manifestDef
		? manifestDef.steps
				.map((step, index) => ({ step, index }))
				.filter((entry) => entry.step.id !== 'linear-webhook')
		: [];
	const webhookStepNumber = renderedManifestSteps.length + 2; // +1 for provider, +1 for 1-indexed
	const saveStepNumber = webhookStepNumber + 1;

	// ---- Render ----

	return (
		<div className="space-y-3">
			{/* Step 1: Provider */}
			<WizardStep
				stepNumber={1}
				title="Provider"
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

			{/*
			 * Plan 011/4: dynamic manifest-step rendering. Each provider's
			 * `wizardSpec.steps` drives its own slot count. We skip steps of
			 * kind `webhook-url-display` because the legacy WebhookStep below
			 * still owns programmatic webhook creation (Trello/JIRA API calls)
			 * and per-provider setup UX. The shared `webhook-url-display`
			 * component (widened in plan 011/1) is dormant for the three
			 * existing providers until a future plan ports webhook-creation
			 * UX into the manifest path.
			 */}
			{manifestDef &&
				renderedManifestSteps.map((entry, idx) => {
					const stepNumber = idx + 2; // 1 is Provider picker
					const isCredentials = entry.step.id === manifestDef.steps[0]?.id;
					return (
						<WizardStep
							key={entry.step.id}
							stepNumber={stepNumber}
							title={entry.step.title}
							status={getStatus(stepNumber, entry.step.isComplete(state))}
							isOpen={openSteps.has(stepNumber)}
							onToggle={() => toggleStep(stepNumber)}
						>
							<ManifestProviderWizardSection
								def={manifestDef}
								state={state}
								dispatch={dispatch}
								projectId={projectId}
								advanceToStep={advanceToStep}
								stepIndex={entry.index}
							/>

							{/* Verify Connection button still belongs on the first
							    manifest step (credentials). */}
							{isCredentials && (
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
											Connected as{' '}
											<span className="font-medium">{state.verificationResult.display}</span>
										</div>
									)}
									{state.verifyError && (
										<div className="flex items-center gap-1.5 text-sm text-destructive">
											<XCircle className="h-4 w-4" />
											{state.verifyError}
										</div>
									)}
								</div>
							)}
						</WizardStep>
					);
				})}

			{/* Legacy Webhook slot — still handles programmatic webhook
			    registration for Trello/JIRA + the signing-secret UX for
			    Linear. Scheduled for migration into the manifest path in a
			    future plan. */}
			<WizardStep
				stepNumber={webhookStepNumber}
				title="Webhooks"
				status={getStatus(webhookStepNumber, true)}
				isOpen={openSteps.has(webhookStepNumber)}
				onToggle={() => toggleStep(webhookStepNumber)}
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

			{/* Save slot. */}
			<WizardStep
				stepNumber={saveStepNumber}
				title="Save"
				status={getStatus(saveStepNumber, saveMutation.isSuccess)}
				isOpen={openSteps.has(saveStepNumber)}
				onToggle={() => toggleStep(saveStepNumber)}
			>
				<SaveStep state={state} saveMutation={saveMutation} />
			</WizardStep>
		</div>
	);
}
