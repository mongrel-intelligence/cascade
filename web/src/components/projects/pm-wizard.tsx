import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Globe, Loader2, XCircle } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
// Single barrel import registers every PM provider's frontend wizard into the
// provider registry. New providers add one import to pm-providers/index.ts —
// this file never needs to change for a new provider.
import './pm-providers/index.js';
import { ManifestProviderWizardSection } from './pm-providers/manifest-section.js';
import { getProviderWizard, listProviderWizards } from './pm-providers/registry.js';
import type { ProviderWizardDefinition } from './pm-providers/types.js';
import { SaveStep } from './pm-wizard-common-steps.js';
import { useSaveMutation, useVerification } from './pm-wizard-hooks.js';
// Plan 011/5: the three legacy `pm-wizard-{trello,jira,linear}-steps.tsx`
// files were deleted; all three providers now render exclusively through
// the manifest path (see `./pm-providers/<provider>/wizard.ts`).
// Plan 012/4: `WebhookStep` + `LinearWebhookInfoPanel` + supporting hooks
// deleted; every provider owns its webhook UX via the manifest path.
import {
	areCredentialsReady,
	buildEditState,
	createInitialState,
	isStep1Complete,
	type Provider,
	type WizardAction,
	type WizardState,
	wizardReducer,
} from './pm-wizard-state.js';
import { WizardStep } from './wizard-shared.js';

// ============================================================================
// Constants
// ============================================================================

// Plan 011/4: step titles now come from each provider's wizard definition
// (manifestDef.steps[i].title). Only step 1 (provider picker) and the
// legacy Webhook + Save slots have fixed titles; rendered inline.

function confirmProviderSwitch(fromLabel: string, toLabel: string): boolean {
	return window.confirm(
		`Switch PM provider from ${fromLabel} to ${toLabel}?\n\nYou'll need to re-enter credentials and re-map fields for ${toLabel}. The old provider's credentials will be deleted when you save.`,
	);
}

// ============================================================================
// ManifestStepsSection — single-instance hook wrapper
// ============================================================================

interface ManifestStepsSectionProps {
	readonly manifestDef: ProviderWizardDefinition;
	readonly state: WizardState;
	readonly dispatch: React.Dispatch<WizardAction>;
	readonly projectId: string;
	readonly advanceToStep: (step: number) => void;
	readonly getStatus: (
		stepNum: number,
		complete: boolean,
	) => 'pending' | 'complete' | 'error' | 'active';
	readonly openSteps: Set<number>;
	readonly toggleStep: (step: number) => void;
	readonly credsReady: boolean;
	readonly verifyPending: boolean;
	readonly onVerify: () => void;
	readonly verificationResult: { display: string } | null | undefined;
	readonly verifyError: string | null | undefined;
	readonly hasStoredCredentials: boolean;
	readonly isEditing: boolean;
}

/**
 * Renders all manifest-driven wizard steps for a single provider.
 *
 * Exists so useProviderHooks is called exactly once regardless of how many
 * steps the provider declares. Calling it inside ManifestProviderWizardSection
 * (which is instantiated once per step) created N independent hook instances
 * and an N× discovery request storm on mount.
 */
function ManifestStepsSection({
	manifestDef,
	state,
	dispatch,
	projectId,
	advanceToStep,
	getStatus,
	openSteps,
	toggleStep,
	credsReady,
	verifyPending,
	onVerify,
	verificationResult,
	verifyError,
	hasStoredCredentials,
	isEditing,
}: ManifestStepsSectionProps) {
	// Called exactly once — the whole point of this wrapper component.
	const providerHooks =
		manifestDef.useProviderHooks?.({ state, dispatch, projectId, advanceToStep }) ?? {};

	return (
		<>
			{manifestDef.steps.map((step, index) => {
				const stepNumber = index + 2; // step 1 is Provider picker
				const isCredentials = index === 0;
				return (
					<WizardStep
						key={step.id}
						stepNumber={stepNumber}
						title={step.title}
						status={getStatus(stepNumber, step.isComplete(state))}
						isOpen={openSteps.has(stepNumber)}
						onToggle={() => toggleStep(stepNumber)}
					>
						<ManifestProviderWizardSection
							def={manifestDef}
							state={state}
							dispatch={dispatch}
							providerHooks={providerHooks}
							stepIndex={index}
						/>

						{/* Verify Connection belongs on the first manifest step (credentials). */}
						{isCredentials && (
							<div className="flex items-center gap-3 pt-2">
								<button
									type="button"
									onClick={onVerify}
									disabled={!(credsReady || (isEditing && hasStoredCredentials)) || verifyPending}
									className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								>
									{verifyPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Globe className="h-4 w-4" />
									)}
									Verify Connection
								</button>
								{!credsReady && isEditing && hasStoredCredentials && (
									<span className="text-xs text-muted-foreground">Using stored credentials</span>
								)}
								{verificationResult && (
									<div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
										<CheckCircle className="h-4 w-4" />
										Connected as <span className="font-medium">{verificationResult.display}</span>
									</div>
								)}
								{verifyError && (
									<div className="flex items-center gap-1.5 text-sm text-destructive">
										<XCircle className="h-4 w-4" />
										{verifyError}
									</div>
								)}
							</div>
						)}
					</WizardStep>
				);
			})}
		</>
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
	if (!manifestDef) {
		throw new Error(`No PM provider wizard registered for ${state.provider}`);
	}

	const { verifyMutation } = useVerification(
		state,
		dispatch,
		advanceToStep,
		projectId,
		manifestDef,
	);
	// Every PM provider (Trello 006/2, JIRA 006/3, Linear 006/4) composes its
	// discovery / label / custom-field / webhook hooks inside its own
	// useProviderHooks. The parent wizard no longer calls any provider-
	// specific React hook.
	const { saveMutation } = useSaveMutation(projectId, state, manifestDef);

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

	// ---- Manifest step layout (plans 011/4 + 012/1-4) ----
	// saveStepNumber: provider picker is 1, manifest steps are 2…(N+1), save is N+2.
	const saveStepNumber = (manifestDef?.steps.length ?? 0) + 2;

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
						{listProviderWizards().map((wizard) => (
							<button
								key={wizard.id}
								type="button"
								onClick={() => {
									if (wizard.id === state.provider) return;
									if (state.isEditing) {
										const fromLabel = getProviderWizard(state.provider)?.label ?? state.provider;
										if (!confirmProviderSwitch(fromLabel, wizard.label)) return;
									}
									dispatch({ type: 'SET_PROVIDER', provider: wizard.id as Provider });
									advanceToStep(2);
								}}
								className={`flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
									state.provider === wizard.id
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50'
								}`}
							>
								{wizard.label}
							</button>
						))}
					</div>
				</div>
			</WizardStep>

			{/*
			 * Plan 011/4 + 012/4: dynamic manifest-step rendering. Each
			 * provider's `wizardSpec.steps` drives its own slot count. Every
			 * step — including webhook-url-display — renders via the manifest
			 * path. Parent wizard owns only the provider picker (step 1) and
			 * the final Save step. ManifestStepsSection calls useProviderHooks
			 * exactly once regardless of step count (storm fix).
			 */}
			{manifestDef && (
				<ManifestStepsSection
					key={manifestDef.id}
					manifestDef={manifestDef}
					state={state}
					dispatch={dispatch}
					projectId={projectId}
					advanceToStep={advanceToStep}
					getStatus={getStatus}
					openSteps={openSteps}
					toggleStep={toggleStep}
					credsReady={credsReady}
					verifyPending={verifyMutation.isPending}
					onVerify={() => verifyMutation.mutate()}
					verificationResult={state.verificationResult}
					verifyError={state.verifyError}
					hasStoredCredentials={state.hasStoredCredentials}
					isEditing={state.isEditing}
				/>
			)}

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
