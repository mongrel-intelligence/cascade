import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Globe, Loader2, XCircle } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
import { SaveStep, WebhookStep } from './pm-wizard-common-steps.js';
import {
	useJiraCustomFieldCreation,
	useJiraDiscovery,
	useSaveMutation,
	useTrelloCustomFieldCreation,
	useTrelloDiscovery,
	useTrelloLabelCreation,
	useVerification,
	useWebhookManagement,
} from './pm-wizard-hooks.js';
import {
	JiraCredentialsStep,
	JiraFieldMappingStep,
	JiraProjectStep,
} from './pm-wizard-jira-steps.js';
import {
	areCredentialsReady,
	buildEditState,
	createInitialState,
	isStep1Complete,
	isStep2Complete,
	isStep3Complete,
	isStep4Complete,
	wizardReducer,
} from './pm-wizard-state.js';
import {
	TRELLO_LABEL_DEFAULTS,
	TrelloBoardStep,
	TrelloCredentialsStep,
	TrelloFieldMappingStep,
} from './pm-wizard-trello-steps.js';
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
	const [creatingSlot, setCreatingSlot] = useState<string | null>(null);
	const [creatingCostField, setCreatingCostField] = useState(false);
	const [creatingJiraCostField, setCreatingJiraCostField] = useState(false);

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

	const { verifyMutation } = useVerification(state, dispatch, advanceToStep);
	const { boardsMutation, boardDetailsMutation, handleBoardSelect } = useTrelloDiscovery(
		state,
		dispatch,
		advanceToStep,
		projectId,
	);
	const { jiraProjectsMutation, jiraDetailsMutation, handleProjectSelect } = useJiraDiscovery(
		state,
		dispatch,
		advanceToStep,
		projectId,
	);
	const { createLabelMutation, createMissingLabelsMutation } = useTrelloLabelCreation(
		state,
		dispatch,
	);
	const { createCustomFieldMutation } = useTrelloCustomFieldCreation(state, dispatch);
	const { createJiraCustomFieldMutation } = useJiraCustomFieldCreation(state, dispatch);
	const webhookManagement = useWebhookManagement(projectId, state);
	const { saveMutation } = useSaveMutation(projectId, state);

	// ---- Label creation handlers ----

	const handleCreateLabel = (slot: string) => {
		const defaults = TRELLO_LABEL_DEFAULTS[slot];
		if (!defaults) return;
		setCreatingSlot(slot);
		createLabelMutation.mutate(
			{ name: defaults.name, color: defaults.color, slot },
			{
				onSettled: () => setCreatingSlot(null),
			},
		);
	};

	const handleCreateCostField = () => {
		setCreatingCostField(true);
		createCustomFieldMutation.mutate(undefined, {
			onSettled: () => setCreatingCostField(false),
		});
	};

	const handleCreateJiraCostField = () => {
		setCreatingJiraCostField(true);
		createJiraCustomFieldMutation.mutate(undefined, {
			onSettled: () => setCreatingJiraCostField(false),
		});
	};

	const handleCreateAllMissingLabels = () => {
		const existingLabelNames = new Set(
			(state.trelloBoardDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
		);
		const labelsToCreate = Object.entries(TRELLO_LABEL_DEFAULTS)
			.filter(([slot, { name }]) => {
				if (state.trelloLabelMappings[slot]) return false;
				return !existingLabelNames.has(name.toLowerCase());
			})
			.map(([slot, { name, color }]) => ({ slot, name, color }));
		if (labelsToCreate.length > 0) {
			setCreatingSlot('__batch__');
			createMissingLabelsMutation.mutate(labelsToCreate, {
				onSettled: () => setCreatingSlot(null),
			});
		}
	};

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
	const activeWebhooks =
		state.provider === 'trello'
			? (webhooksQuery.data?.trello ?? []).map((w) => ({
					id: String(w.id),
					url: w.callbackURL,
					active: w.active,
				}))
			: (webhooksQuery.data?.jira ?? []).map((w) => ({
					id: String(w.id),
					url: w.url,
					active: w.enabled,
				}));

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
						{(['trello', 'jira'] as const).map((p) => (
							<button
								key={p}
								type="button"
								disabled={state.isEditing}
								onClick={() => {
									dispatch({ type: 'SET_PROVIDER', provider: p });
									advanceToStep(2);
								}}
								className={`flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
									state.provider === p
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50'
								} ${state.isEditing ? 'cursor-not-allowed opacity-60' : ''}`}
							>
								{p === 'trello' ? 'Trello' : 'JIRA'}
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
				{state.provider === 'trello' ? (
					<TrelloCredentialsStep state={state} dispatch={dispatch} />
				) : (
					<JiraCredentialsStep state={state} dispatch={dispatch} />
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
				{state.provider === 'trello' ? (
					<TrelloBoardStep
						state={state}
						onBoardSelect={handleBoardSelect}
						boardsMutation={boardsMutation}
						boardDetailsMutation={boardDetailsMutation}
					/>
				) : (
					<JiraProjectStep
						state={state}
						onProjectSelect={handleProjectSelect}
						jiraProjectsMutation={jiraProjectsMutation}
						jiraDetailsMutation={jiraDetailsMutation}
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
				{state.provider === 'trello' ? (
					<TrelloFieldMappingStep
						state={state}
						dispatch={dispatch}
						onCreateLabel={handleCreateLabel}
						onCreateAllMissingLabels={handleCreateAllMissingLabels}
						onCreateCostField={handleCreateCostField}
						creatingSlot={creatingSlot}
						creatingCostField={creatingCostField}
					/>
				) : (
					<JiraFieldMappingStep
						state={state}
						dispatch={dispatch}
						onCreateCostField={handleCreateJiraCostField}
						creatingCostField={creatingJiraCostField}
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
