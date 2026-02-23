import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertCircle,
	Check,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Globe,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	XCircle,
} from 'lucide-react';
import { type Reducer, useEffect, useReducer, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface CredentialOption {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
}

interface TrelloBoardOption {
	id: string;
	name: string;
	url: string;
}

interface TrelloBoardDetails {
	lists: Array<{ id: string; name: string }>;
	labels: Array<{ id: string; name: string; color: string }>;
	customFields: Array<{ id: string; name: string; type: string }>;
}

interface JiraProjectOption {
	key: string;
	name: string;
}

interface JiraProjectDetails {
	statuses: Array<{ name: string; id: string }>;
	issueTypes: Array<{ name: string; subtask: boolean }>;
	fields: Array<{ id: string; name: string; custom: boolean }>;
}

// ============================================================================
// Wizard State
// ============================================================================

type Provider = 'trello' | 'jira';

interface WizardState {
	provider: Provider;
	// Step 2: Credentials
	trelloApiKeyCredentialId: number | null;
	trelloTokenCredentialId: number | null;
	jiraEmailCredentialId: number | null;
	jiraApiTokenCredentialId: number | null;
	jiraBaseUrl: string;
	verificationResult: { provider: Provider; display: string } | null;
	verifyError: string | null;
	// Step 3: Board/Project
	trelloBoardId: string;
	trelloBoards: TrelloBoardOption[];
	jiraProjectKey: string;
	jiraProjects: JiraProjectOption[];
	// Step 4: Field mapping
	trelloBoardDetails: TrelloBoardDetails | null;
	jiraProjectDetails: JiraProjectDetails | null;
	// Trello mappings
	trelloListMappings: Record<string, string>;
	trelloLabelMappings: Record<string, string>;
	trelloCostFieldId: string;
	// JIRA mappings
	jiraStatusMappings: Record<string, string>;
	jiraIssueTypes: Record<string, string>;
	jiraLabels: Record<string, string>;
	jiraCostFieldId: string;
	// Editing mode
	isEditing: boolean;
}

type WizardAction =
	| { type: 'SET_PROVIDER'; provider: Provider }
	| { type: 'SET_TRELLO_API_KEY_CRED'; id: number | null }
	| { type: 'SET_TRELLO_TOKEN_CRED'; id: number | null }
	| { type: 'SET_JIRA_EMAIL_CRED'; id: number | null }
	| { type: 'SET_JIRA_API_TOKEN_CRED'; id: number | null }
	| { type: 'SET_JIRA_BASE_URL'; url: string }
	| {
			type: 'SET_VERIFICATION';
			result: { provider: Provider; display: string } | null;
			error?: string | null;
	  }
	| { type: 'SET_TRELLO_BOARDS'; boards: TrelloBoardOption[] }
	| { type: 'SET_TRELLO_BOARD_ID'; id: string }
	| { type: 'SET_JIRA_PROJECTS'; projects: JiraProjectOption[] }
	| { type: 'SET_JIRA_PROJECT_KEY'; key: string }
	| { type: 'SET_TRELLO_BOARD_DETAILS'; details: TrelloBoardDetails | null }
	| { type: 'SET_JIRA_PROJECT_DETAILS'; details: JiraProjectDetails | null }
	| { type: 'SET_TRELLO_LIST_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_LABEL_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_COST_FIELD'; id: string }
	| { type: 'SET_JIRA_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_JIRA_ISSUE_TYPE'; key: string; value: string }
	| { type: 'SET_JIRA_LABEL'; key: string; value: string }
	| { type: 'SET_JIRA_COST_FIELD'; id: string }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> };

const INITIAL_JIRA_LABELS: Record<string, string> = {
	processing: 'cascade-processing',
	processed: 'cascade-processed',
	error: 'cascade-error',
	readyToProcess: 'cascade-ready',
};

function createInitialState(): WizardState {
	return {
		provider: 'trello',
		trelloApiKeyCredentialId: null,
		trelloTokenCredentialId: null,
		jiraEmailCredentialId: null,
		jiraApiTokenCredentialId: null,
		jiraBaseUrl: '',
		verificationResult: null,
		verifyError: null,
		trelloBoardId: '',
		trelloBoards: [],
		jiraProjectKey: '',
		jiraProjects: [],
		trelloBoardDetails: null,
		jiraProjectDetails: null,
		trelloListMappings: {},
		trelloLabelMappings: {},
		trelloCostFieldId: '',
		jiraStatusMappings: {},
		jiraIssueTypes: {},
		jiraLabels: { ...INITIAL_JIRA_LABELS },
		jiraCostFieldId: '',
		isEditing: false,
	};
}

const wizardReducer: Reducer<WizardState, WizardAction> = (state, action) => {
	switch (action.type) {
		case 'SET_PROVIDER':
			return {
				...createInitialState(),
				provider: action.provider,
			};
		case 'SET_TRELLO_API_KEY_CRED':
			return {
				...state,
				trelloApiKeyCredentialId: action.id,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_TRELLO_TOKEN_CRED':
			return {
				...state,
				trelloTokenCredentialId: action.id,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_EMAIL_CRED':
			return {
				...state,
				jiraEmailCredentialId: action.id,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_API_TOKEN_CRED':
			return {
				...state,
				jiraApiTokenCredentialId: action.id,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_BASE_URL':
			return { ...state, jiraBaseUrl: action.url, verificationResult: null, verifyError: null };
		case 'SET_VERIFICATION':
			return { ...state, verificationResult: action.result, verifyError: action.error ?? null };
		case 'SET_TRELLO_BOARDS':
			return { ...state, trelloBoards: action.boards };
		case 'SET_TRELLO_BOARD_ID':
			return {
				...state,
				trelloBoardId: action.id,
				trelloBoardDetails: null,
				trelloListMappings: {},
				trelloLabelMappings: {},
				trelloCostFieldId: '',
			};
		case 'SET_JIRA_PROJECTS':
			return { ...state, jiraProjects: action.projects };
		case 'SET_JIRA_PROJECT_KEY':
			return {
				...state,
				jiraProjectKey: action.key,
				jiraProjectDetails: null,
				jiraStatusMappings: {},
				jiraIssueTypes: {},
				jiraCostFieldId: '',
			};
		case 'SET_TRELLO_BOARD_DETAILS':
			return { ...state, trelloBoardDetails: action.details };
		case 'SET_JIRA_PROJECT_DETAILS':
			return { ...state, jiraProjectDetails: action.details };
		case 'SET_TRELLO_LIST_MAPPING':
			return {
				...state,
				trelloListMappings: { ...state.trelloListMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_LABEL_MAPPING':
			return {
				...state,
				trelloLabelMappings: { ...state.trelloLabelMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_COST_FIELD':
			return { ...state, trelloCostFieldId: action.id };
		case 'SET_JIRA_STATUS_MAPPING':
			return {
				...state,
				jiraStatusMappings: { ...state.jiraStatusMappings, [action.key]: action.value },
			};
		case 'SET_JIRA_ISSUE_TYPE':
			return {
				...state,
				jiraIssueTypes: { ...state.jiraIssueTypes, [action.key]: action.value },
			};
		case 'SET_JIRA_LABEL':
			return {
				...state,
				jiraLabels: { ...state.jiraLabels, [action.key]: action.value },
			};
		case 'SET_JIRA_COST_FIELD':
			return { ...state, jiraCostFieldId: action.id };
		case 'INIT_EDIT':
			return { ...state, ...action.state, isEditing: true };
		default:
			return state;
	}
};

// ============================================================================
// Wizard Step Shell
// ============================================================================

const STEP_TITLES = [
	'Provider',
	'Credentials & Verification',
	'Board / Project Selection',
	'Field Mapping',
	'Webhooks',
	'Save',
] as const;

function WizardStep({
	stepNumber,
	title,
	status,
	isOpen,
	onToggle,
	children,
}: {
	stepNumber: number;
	title: string;
	status: 'pending' | 'complete' | 'error' | 'active';
	isOpen: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className="border rounded-lg overflow-hidden">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
			>
				<div
					className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
						status === 'complete'
							? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
							: status === 'error'
								? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
								: status === 'active'
									? 'bg-primary text-primary-foreground'
									: 'bg-muted text-muted-foreground'
					}`}
				>
					{status === 'complete' ? <Check className="h-4 w-4" /> : stepNumber}
				</div>
				<span className="flex-1 text-sm font-medium">{title}</span>
				{isOpen ? (
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				)}
			</button>
			{isOpen && <div className="border-t px-4 py-4 space-y-4">{children}</div>}
		</div>
	);
}

// ============================================================================
// Inline Credential Creator
// ============================================================================

function InlineCredentialCreator({
	onCreated,
}: {
	onCreated: (id: number) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [name, setName] = useState('');
	const [envVarKey, setEnvVarKey] = useState('');
	const [value, setValue] = useState('');
	const queryClient = useQueryClient();

	const createMutation = useMutation({
		mutationFn: async () => {
			return trpcClient.credentials.create.mutate({
				name,
				envVarKey,
				value,
				isDefault: false,
			});
		},
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: trpc.credentials.list.queryOptions().queryKey,
			});
			onCreated((result as { id: number }).id);
			setIsOpen(false);
			setName('');
			setEnvVarKey('');
			setValue('');
		},
	});

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<Plus className="h-3 w-3" /> Create new
			</button>
		);
	}

	return (
		<div className="rounded-md border border-dashed p-3 space-y-2">
			<div className="flex gap-2">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Name (e.g. My Trello Key)"
					className="flex-1"
				/>
				<Input
					value={envVarKey}
					onChange={(e) => setEnvVarKey(e.target.value.toUpperCase())}
					placeholder="ENV_VAR_KEY"
					className="flex-1"
				/>
			</div>
			<Input
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Secret value"
				type="password"
			/>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => createMutation.mutate()}
					disabled={!name || !envVarKey || !value || createMutation.isPending}
					className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
				</button>
				<button
					type="button"
					onClick={() => setIsOpen(false)}
					className="inline-flex h-8 items-center rounded-md border px-3 text-xs hover:bg-accent"
				>
					Cancel
				</button>
				{createMutation.isError && (
					<span className="text-xs text-destructive self-center">
						{createMutation.error.message}
					</span>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Searchable Select
// ============================================================================

function SearchableSelect<T extends { label: string; value: string; detail?: string }>({
	options,
	value,
	onChange,
	placeholder,
	isLoading,
	error,
	onRetry,
}: {
	options: T[];
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	isLoading?: boolean;
	error?: string | null;
	onRetry?: () => void;
}) {
	const [search, setSearch] = useState('');

	const filtered = search
		? options.filter(
				(o) =>
					o.value === value ||
					o.label.toLowerCase().includes(search.toLowerCase()) ||
					o.value.toLowerCase().includes(search.toLowerCase()) ||
					o.detail?.toLowerCase().includes(search.toLowerCase()),
			)
		: options;

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
				<Loader2 className="h-4 w-4 animate-spin" /> Loading...
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-2">
				<div className="flex items-center gap-2 text-sm text-destructive">
					<AlertCircle className="h-4 w-4" /> {error}
				</div>
				{onRetry && (
					<button
						type="button"
						onClick={onRetry}
						className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>
						<RefreshCw className="h-3 w-3" /> Retry
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{options.length > 5 && (
				<Input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Filter..."
					className="h-8 text-sm"
				/>
			)}
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				<option value="">{placeholder}</option>
				{filtered.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
						{o.detail ? ` — ${o.detail}` : ''}
					</option>
				))}
			</select>
		</div>
	);
}

// ============================================================================
// Field Mapping Row
// ============================================================================

function FieldMappingRow({
	slotLabel,
	options,
	value,
	onChange,
	manualFallback,
}: {
	slotLabel: string;
	options: Array<{ label: string; value: string }>;
	value: string;
	onChange: (value: string) => void;
	manualFallback?: boolean;
}) {
	const [isManual, setIsManual] = useState(false);

	// If the value doesn't match any option, show manual mode
	const hasMatch = !value || options.some((o) => o.value === value);
	const showManual = isManual || (value && !hasMatch && manualFallback);

	return (
		<div className="flex items-center gap-2">
			<span className="w-28 shrink-0 text-sm text-muted-foreground">{slotLabel}</span>
			{showManual ? (
				<div className="flex flex-1 gap-2">
					<Input
						value={value}
						onChange={(e) => onChange(e.target.value)}
						placeholder="Enter ID manually"
						className="flex-1"
					/>
					{manualFallback && (
						<button
							type="button"
							onClick={() => setIsManual(false)}
							className="text-xs text-muted-foreground hover:text-foreground shrink-0"
						>
							use dropdown
						</button>
					)}
				</div>
			) : (
				<div className="flex flex-1 gap-2">
					<select
						value={value}
						onChange={(e) => onChange(e.target.value)}
						className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="">-- not set --</option>
						{options.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
					{manualFallback && (
						<button
							type="button"
							onClick={() => setIsManual(true)}
							className="text-xs text-muted-foreground hover:text-foreground shrink-0"
						>
							enter manually
						</button>
					)}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// CASCADE slot key definitions
// ============================================================================

const TRELLO_LIST_SLOTS = [
	'briefing',
	'stories',
	'planning',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
	'debug',
];

const TRELLO_LABEL_SLOTS = ['readyToProcess', 'processing', 'processed', 'error'];

const JIRA_STATUS_SLOTS = [
	'briefing',
	'planning',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
];

const JIRA_LABEL_SLOTS = ['processing', 'processed', 'error', 'readyToProcess'];

// ============================================================================
// Main PMWizard Component
// ============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: wizard component with provider-specific branching across 6 steps
export function PMWizard({
	projectId,
	initialProvider,
	initialConfig,
	initialCredentials,
}: {
	projectId: string;
	initialProvider: string;
	initialConfig?: Record<string, unknown>;
	initialCredentials: Map<string, number>;
}) {
	const queryClient = useQueryClient();
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());
	const orgCredentials = (credentialsQuery.data ?? []) as CredentialOption[];
	const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId }));

	const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);
	const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));

	// Initialize from existing integration
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: restoring state from two provider config shapes
	useEffect(() => {
		if (!initialConfig || !initialProvider) return;

		const editState: Partial<WizardState> = {
			provider: initialProvider as Provider,
		};

		// Restore credential selections
		if (initialProvider === 'trello') {
			editState.trelloApiKeyCredentialId = initialCredentials.get('api_key') ?? null;
			editState.trelloTokenCredentialId = initialCredentials.get('token') ?? null;
			editState.trelloBoardId = (initialConfig.boardId as string) ?? '';

			const lists = initialConfig.lists as Record<string, string> | undefined;
			if (lists) editState.trelloListMappings = lists;

			const labels = initialConfig.labels as Record<string, string> | undefined;
			if (labels) editState.trelloLabelMappings = labels;

			const cf = initialConfig.customFields as Record<string, string> | undefined;
			editState.trelloCostFieldId = cf?.cost ?? '';
		} else if (initialProvider === 'jira') {
			editState.jiraEmailCredentialId = initialCredentials.get('email') ?? null;
			editState.jiraApiTokenCredentialId = initialCredentials.get('api_token') ?? null;
			editState.jiraBaseUrl = (initialConfig.baseUrl as string) ?? '';
			editState.jiraProjectKey = (initialConfig.projectKey as string) ?? '';

			const statuses = initialConfig.statuses as Record<string, string> | undefined;
			if (statuses) editState.jiraStatusMappings = statuses;

			const issueTypes = initialConfig.issueTypes as Record<string, string> | undefined;
			if (issueTypes) editState.jiraIssueTypes = issueTypes;

			const labels = initialConfig.labels as Record<string, string> | undefined;
			if (labels) editState.jiraLabels = labels;

			const cf = initialConfig.customFields as Record<string, string> | undefined;
			editState.jiraCostFieldId = cf?.cost ?? '';
		}

		dispatch({ type: 'INIT_EDIT', state: editState });
		// In edit mode, open all steps
		setOpenSteps(new Set([1, 2, 3, 4, 5, 6]));
	}, [initialConfig, initialProvider, initialCredentials]);

	// Toggle step open/closed
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

	// ---- Step status calculations ----

	const step1Complete = !!state.provider;

	const credsReady =
		state.provider === 'trello'
			? !!(state.trelloApiKeyCredentialId && state.trelloTokenCredentialId)
			: !!(state.jiraEmailCredentialId && state.jiraApiTokenCredentialId && state.jiraBaseUrl);
	const step2Complete = credsReady && !!state.verificationResult;

	const step3Complete =
		state.provider === 'trello' ? !!state.trelloBoardId : !!state.jiraProjectKey;

	const step4Complete =
		state.provider === 'trello'
			? Object.keys(state.trelloListMappings).length > 0
			: Object.keys(state.jiraStatusMappings).length > 0;

	// Step 5 (webhooks) is optional, always "complete"
	const step5Complete = true;

	function getStatus(
		stepNum: number,
		complete: boolean,
	): 'pending' | 'complete' | 'error' | 'active' {
		if (complete) return 'complete';
		if (openSteps.has(stepNum)) return 'active';
		return 'pending';
	}

	// ---- Mutations ----

	const verifyMutation = useMutation({
		mutationFn: async () => {
			const provider = state.provider;
			if (provider === 'trello') {
				if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
					throw new Error('Select both credentials before verifying');
				}
				const result = await trpcClient.integrationsDiscovery.verifyTrello.mutate({
					apiKeyCredentialId: state.trelloApiKeyCredentialId,
					tokenCredentialId: state.trelloTokenCredentialId,
				});
				return { provider: 'trello' as const, result };
			}
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before verifying');
			}
			const result = await trpcClient.integrationsDiscovery.verifyJira.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
				baseUrl: state.jiraBaseUrl,
			});
			return { provider: 'jira' as const, result };
		},
		onSuccess: ({ provider, result }) => {
			// Ignore if provider changed while we were verifying
			if (provider !== state.provider) return;
			if (provider === 'trello') {
				const r = result as { username: string; fullName: string };
				dispatch({
					type: 'SET_VERIFICATION',
					result: { provider: 'trello', display: `@${r.username} (${r.fullName})` },
				});
			} else {
				const r = result as { displayName: string; emailAddress: string };
				dispatch({
					type: 'SET_VERIFICATION',
					result: { provider: 'jira', display: `${r.displayName} (${r.emailAddress})` },
				});
			}
			advanceToStep(3);
		},
		onError: (err) => {
			dispatch({
				type: 'SET_VERIFICATION',
				result: null,
				error: err instanceof Error ? err.message : String(err),
			});
		},
	});

	const boardsMutation = useMutation({
		mutationFn: () => {
			if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
				throw new Error('Select both credentials before fetching boards');
			}
			return trpcClient.integrationsDiscovery.trelloBoards.mutate({
				apiKeyCredentialId: state.trelloApiKeyCredentialId,
				tokenCredentialId: state.trelloTokenCredentialId,
			});
		},
		onSuccess: (boards) => dispatch({ type: 'SET_TRELLO_BOARDS', boards }),
	});

	const boardDetailsMutation = useMutation({
		mutationFn: (boardId: string) => {
			if (!state.trelloApiKeyCredentialId || !state.trelloTokenCredentialId) {
				throw new Error('Select both credentials before fetching board details');
			}
			return trpcClient.integrationsDiscovery.trelloBoardDetails.mutate({
				apiKeyCredentialId: state.trelloApiKeyCredentialId,
				tokenCredentialId: state.trelloTokenCredentialId,
				boardId,
			});
		},
		onSuccess: (details) => {
			dispatch({ type: 'SET_TRELLO_BOARD_DETAILS', details });
			advanceToStep(4);
		},
	});

	const jiraProjectsMutation = useMutation({
		mutationFn: () => {
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before fetching projects');
			}
			return trpcClient.integrationsDiscovery.jiraProjects.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
				baseUrl: state.jiraBaseUrl,
			});
		},
		onSuccess: (projects) => dispatch({ type: 'SET_JIRA_PROJECTS', projects }),
	});

	const jiraDetailsMutation = useMutation({
		mutationFn: (projectKey: string) => {
			if (!state.jiraEmailCredentialId || !state.jiraApiTokenCredentialId) {
				throw new Error('Select both credentials before fetching project details');
			}
			return trpcClient.integrationsDiscovery.jiraProjectDetails.mutate({
				emailCredentialId: state.jiraEmailCredentialId,
				apiTokenCredentialId: state.jiraApiTokenCredentialId,
				baseUrl: state.jiraBaseUrl,
				projectKey,
			});
		},
		onSuccess: (details) => {
			dispatch({ type: 'SET_JIRA_PROJECT_DETAILS', details });
			advanceToStep(4);
		},
	});

	// Fetch boards/projects when step 3 opens and credentials are verified
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on verification result change
	useEffect(() => {
		if (!state.verificationResult) return;
		if (
			state.provider === 'trello' &&
			state.trelloBoards.length === 0 &&
			!boardsMutation.isPending
		) {
			boardsMutation.mutate();
		} else if (
			state.provider === 'jira' &&
			state.jiraProjects.length === 0 &&
			!jiraProjectsMutation.isPending
		) {
			jiraProjectsMutation.mutate();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.verificationResult]);

	// In edit mode, auto-fetch boards/projects list and details when credentials are present
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger only on edit mode state changes
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: two-provider branching with guard conditions
	useEffect(() => {
		if (!state.isEditing) return;

		if (state.provider === 'trello') {
			if (
				state.trelloApiKeyCredentialId &&
				state.trelloTokenCredentialId &&
				state.trelloBoards.length === 0 &&
				!boardsMutation.isPending
			) {
				boardsMutation.mutate();
			}
			if (
				state.trelloBoardId &&
				!state.trelloBoardDetails &&
				state.trelloApiKeyCredentialId &&
				state.trelloTokenCredentialId &&
				!boardDetailsMutation.isPending
			) {
				boardDetailsMutation.mutate(state.trelloBoardId);
			}
		} else if (state.provider === 'jira') {
			if (
				state.jiraEmailCredentialId &&
				state.jiraApiTokenCredentialId &&
				state.jiraProjects.length === 0 &&
				!jiraProjectsMutation.isPending
			) {
				jiraProjectsMutation.mutate();
			}
			if (
				state.jiraProjectKey &&
				!state.jiraProjectDetails &&
				state.jiraEmailCredentialId &&
				state.jiraApiTokenCredentialId &&
				!jiraDetailsMutation.isPending
			) {
				jiraDetailsMutation.mutate(state.jiraProjectKey);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isEditing, state.trelloBoardId, state.jiraProjectKey]);

	// Fetch board/project details when selection changes
	const handleBoardSelect = (boardId: string) => {
		dispatch({ type: 'SET_TRELLO_BOARD_ID', id: boardId });
		if (boardId) {
			boardDetailsMutation.mutate(boardId);
		}
	};

	const handleProjectSelect = (key: string) => {
		dispatch({ type: 'SET_JIRA_PROJECT_KEY', key });
		if (key) {
			jiraDetailsMutation.mutate(key);
		}
	};

	// ---- Webhook management ----
	const [webhookUrl, setWebhookUrl] = useState(() => {
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		// Dev: replace frontend port with backend port
		return origin.replace(':5173', ':3000');
	});

	const createWebhookMutation = useMutation({
		mutationFn: () =>
			trpcClient.webhooks.create.mutate({
				projectId,
				callbackBaseUrl: webhookUrl,
				trelloOnly: state.provider === 'trello' ? true : undefined,
				jiraOnly: state.provider === 'jira' ? true : undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const deleteWebhookMutation = useMutation({
		mutationFn: (callbackBaseUrl: string) =>
			trpcClient.webhooks.delete.mutate({
				projectId,
				callbackBaseUrl,
				trelloOnly: state.provider === 'trello' ? true : undefined,
				jiraOnly: state.provider === 'jira' ? true : undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.webhooks.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	// ---- Save ----

	const saveMutation = useMutation({
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handles two provider types + credential linking
		mutationFn: async () => {
			let config: Record<string, unknown>;
			if (state.provider === 'trello') {
				config = {
					boardId: state.trelloBoardId,
					lists: state.trelloListMappings,
					labels: state.trelloLabelMappings,
					...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
				};
			} else {
				config = {
					projectKey: state.jiraProjectKey,
					baseUrl: state.jiraBaseUrl,
					statuses: state.jiraStatusMappings,
					...(Object.keys(state.jiraIssueTypes).length > 0
						? { issueTypes: state.jiraIssueTypes }
						: {}),
					...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
					...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
				};
			}

			const result = await trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'pm',
				provider: state.provider,
				config,
			});

			// Set credentials
			const credPairs: Array<{ role: string; credentialId: number }> =
				state.provider === 'trello'
					? [
							...(state.trelloApiKeyCredentialId
								? [{ role: 'api_key', credentialId: state.trelloApiKeyCredentialId }]
								: []),
							...(state.trelloTokenCredentialId
								? [{ role: 'token', credentialId: state.trelloTokenCredentialId }]
								: []),
						]
					: [
							...(state.jiraEmailCredentialId
								? [{ role: 'email', credentialId: state.jiraEmailCredentialId }]
								: []),
							...(state.jiraApiTokenCredentialId
								? [{ role: 'api_token', credentialId: state.jiraApiTokenCredentialId }]
								: []),
						];

			for (const { role, credentialId } of credPairs) {
				await trpcClient.projects.integrationCredentials.set.mutate({
					projectId,
					category: 'pm',
					role,
					credentialId,
				});
			}

			return result;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrationCredentials.list.queryOptions({
					projectId,
					category: 'pm',
				}).queryKey,
			});
		},
	});

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
				status={getStatus(1, step1Complete)}
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
				status={getStatus(2, step2Complete)}
				isOpen={openSteps.has(2)}
				onToggle={() => toggleStep(2)}
			>
				{state.provider === 'trello' ? (
					<div className="space-y-4">
						<div className="space-y-2">
							<Label>API Key</Label>
							<div className="flex gap-2">
								<select
									value={state.trelloApiKeyCredentialId ?? ''}
									onChange={(e) =>
										dispatch({
											type: 'SET_TRELLO_API_KEY_CRED',
											id: e.target.value ? Number(e.target.value) : null,
										})
									}
									className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">Select credential...</option>
									{orgCredentials.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name} ({c.envVarKey}) — {c.value}
										</option>
									))}
								</select>
							</div>
							<InlineCredentialCreator
								onCreated={(id) => dispatch({ type: 'SET_TRELLO_API_KEY_CRED', id })}
							/>
						</div>
						<div className="space-y-2">
							<Label>Token</Label>
							<div className="flex gap-2">
								<select
									value={state.trelloTokenCredentialId ?? ''}
									onChange={(e) =>
										dispatch({
											type: 'SET_TRELLO_TOKEN_CRED',
											id: e.target.value ? Number(e.target.value) : null,
										})
									}
									className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">Select credential...</option>
									{orgCredentials.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name} ({c.envVarKey}) — {c.value}
										</option>
									))}
								</select>
							</div>
							<InlineCredentialCreator
								onCreated={(id) => dispatch({ type: 'SET_TRELLO_TOKEN_CRED', id })}
							/>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<Label>Base URL</Label>
							<Input
								value={state.jiraBaseUrl}
								onChange={(e) => dispatch({ type: 'SET_JIRA_BASE_URL', url: e.target.value })}
								placeholder="https://your-instance.atlassian.net"
							/>
						</div>
						<div className="space-y-2">
							<Label>Email</Label>
							<select
								value={state.jiraEmailCredentialId ?? ''}
								onChange={(e) =>
									dispatch({
										type: 'SET_JIRA_EMAIL_CRED',
										id: e.target.value ? Number(e.target.value) : null,
									})
								}
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value="">Select credential...</option>
								{orgCredentials.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name} ({c.envVarKey}) — {c.value}
									</option>
								))}
							</select>
							<InlineCredentialCreator
								onCreated={(id) => dispatch({ type: 'SET_JIRA_EMAIL_CRED', id })}
							/>
						</div>
						<div className="space-y-2">
							<Label>API Token</Label>
							<select
								value={state.jiraApiTokenCredentialId ?? ''}
								onChange={(e) =>
									dispatch({
										type: 'SET_JIRA_API_TOKEN_CRED',
										id: e.target.value ? Number(e.target.value) : null,
									})
								}
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value="">Select credential...</option>
								{orgCredentials.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name} ({c.envVarKey}) — {c.value}
									</option>
								))}
							</select>
							<InlineCredentialCreator
								onCreated={(id) => dispatch({ type: 'SET_JIRA_API_TOKEN_CRED', id })}
							/>
						</div>
					</div>
				)}

				<div className="flex items-center gap-3 pt-2">
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
					{state.verificationResult && (
						<div className="flex items-center gap-1.5 text-sm text-green-600">
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
				status={getStatus(3, step3Complete)}
				isOpen={openSteps.has(3)}
				onToggle={() => toggleStep(3)}
			>
				{state.provider === 'trello' ? (
					<div className="space-y-2">
						<Label>Select Board</Label>
						<SearchableSelect
							options={state.trelloBoards.map((b) => ({
								label: b.name,
								value: b.id,
								detail: b.url.split('/').pop(),
							}))}
							value={state.trelloBoardId}
							onChange={handleBoardSelect}
							placeholder="Select a Trello board..."
							isLoading={boardsMutation.isPending}
							error={boardsMutation.isError ? boardsMutation.error.message : null}
							onRetry={() => boardsMutation.mutate()}
						/>
						{state.trelloBoardId && boardDetailsMutation.isPending && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading board details...
							</div>
						)}
					</div>
				) : (
					<div className="space-y-2">
						<Label>Select Project</Label>
						<SearchableSelect
							options={state.jiraProjects.map((p) => ({
								label: p.name,
								value: p.key,
								detail: p.key,
							}))}
							value={state.jiraProjectKey}
							onChange={handleProjectSelect}
							placeholder="Select a JIRA project..."
							isLoading={jiraProjectsMutation.isPending}
							error={jiraProjectsMutation.isError ? jiraProjectsMutation.error.message : null}
							onRetry={() => jiraProjectsMutation.mutate()}
						/>
						{state.jiraProjectKey && jiraDetailsMutation.isPending && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading project details...
							</div>
						)}
					</div>
				)}
			</WizardStep>

			{/* Step 4: Field Mapping */}
			<WizardStep
				stepNumber={4}
				title={STEP_TITLES[3]}
				status={getStatus(4, step4Complete)}
				isOpen={openSteps.has(4)}
				onToggle={() => toggleStep(4)}
			>
				{state.provider === 'trello' ? (
					<div className="space-y-6">
						{/* List mappings */}
						<div className="space-y-3">
							<Label>List Mappings</Label>
							<p className="text-xs text-muted-foreground">
								Map each CASCADE stage to a Trello list on the board.
							</p>
							{state.trelloBoardDetails ? (
								TRELLO_LIST_SLOTS.map((slot) => (
									<FieldMappingRow
										key={slot}
										slotLabel={slot}
										options={
											state.trelloBoardDetails?.lists.map((l) => ({
												label: l.name,
												value: l.id,
											})) ?? []
										}
										value={state.trelloListMappings[slot] ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_TRELLO_LIST_MAPPING',
												key: slot,
												value: v,
											})
										}
										manualFallback
									/>
								))
							) : (
								<p className="text-sm text-muted-foreground">
									Select a board first to populate list options.
								</p>
							)}
						</div>

						{/* Label mappings */}
						<div className="space-y-3">
							<Label>Label Mappings</Label>
							<p className="text-xs text-muted-foreground">
								Map each CASCADE label to a Trello label on the board.
							</p>
							{state.trelloBoardDetails ? (
								TRELLO_LABEL_SLOTS.map((slot) => (
									<FieldMappingRow
										key={slot}
										slotLabel={slot}
										options={
											state.trelloBoardDetails?.labels
												.filter((l) => l.name)
												.map((l) => ({
													label: `${l.name} (${l.color})`,
													value: l.id,
												})) ?? []
										}
										value={state.trelloLabelMappings[slot] ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_TRELLO_LABEL_MAPPING',
												key: slot,
												value: v,
											})
										}
										manualFallback
									/>
								))
							) : (
								<p className="text-sm text-muted-foreground">
									Select a board first to populate label options.
								</p>
							)}
						</div>

						{/* Cost custom field */}
						<div className="space-y-2">
							<Label>Custom Field: Cost</Label>
							{state.trelloBoardDetails ? (
								<FieldMappingRow
									slotLabel="cost"
									options={state.trelloBoardDetails.customFields
										.filter((f) => f.type === 'number')
										.map((f) => ({
											label: f.name,
											value: f.id,
										}))}
									value={state.trelloCostFieldId}
									onChange={(v) => dispatch({ type: 'SET_TRELLO_COST_FIELD', id: v })}
									manualFallback
								/>
							) : (
								<Input
									value={state.trelloCostFieldId}
									onChange={(e) =>
										dispatch({
											type: 'SET_TRELLO_COST_FIELD',
											id: e.target.value,
										})
									}
									placeholder="Custom field ID for cost tracking"
								/>
							)}
						</div>
					</div>
				) : (
					<div className="space-y-6">
						{/* Status mappings */}
						<div className="space-y-3">
							<Label>Status Mappings</Label>
							<p className="text-xs text-muted-foreground">
								Map each CASCADE status to a JIRA status in the project.
							</p>
							{state.jiraProjectDetails ? (
								JIRA_STATUS_SLOTS.map((slot) => (
									<FieldMappingRow
										key={slot}
										slotLabel={slot}
										options={
											state.jiraProjectDetails?.statuses.map((s) => ({
												label: s.name,
												value: s.name,
											})) ?? []
										}
										value={state.jiraStatusMappings[slot] ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_JIRA_STATUS_MAPPING',
												key: slot,
												value: v,
											})
										}
										manualFallback
									/>
								))
							) : (
								<p className="text-sm text-muted-foreground">
									Select a project first to populate status options.
								</p>
							)}
						</div>

						{/* Issue types */}
						<div className="space-y-3">
							<Label>Issue Types (optional)</Label>
							<p className="text-xs text-muted-foreground">
								Map CASCADE issue types. Typically &quot;task&quot; for the main type and
								&quot;subtask&quot; for sub-tasks.
							</p>
							{state.jiraProjectDetails ? (
								<>
									<FieldMappingRow
										slotLabel="task"
										options={state.jiraProjectDetails.issueTypes
											.filter((t) => !t.subtask)
											.map((t) => ({
												label: t.name,
												value: t.name,
											}))}
										value={state.jiraIssueTypes.task ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_JIRA_ISSUE_TYPE',
												key: 'task',
												value: v,
											})
										}
										manualFallback
									/>
									<FieldMappingRow
										slotLabel="subtask"
										options={state.jiraProjectDetails.issueTypes
											.filter((t) => t.subtask)
											.map((t) => ({
												label: t.name,
												value: t.name,
											}))}
										value={state.jiraIssueTypes.subtask ?? ''}
										onChange={(v) =>
											dispatch({
												type: 'SET_JIRA_ISSUE_TYPE',
												key: 'subtask',
												value: v,
											})
										}
										manualFallback
									/>
								</>
							) : (
								<p className="text-sm text-muted-foreground">Select a project first.</p>
							)}
						</div>

						{/* Labels */}
						<div className="space-y-3">
							<Label>Labels</Label>
							<p className="text-xs text-muted-foreground">
								CASCADE label names used in JIRA. These are created automatically by CASCADE.
							</p>
							{JIRA_LABEL_SLOTS.map((slot) => (
								<div key={slot} className="flex items-center gap-2">
									<span className="w-28 shrink-0 text-sm text-muted-foreground">{slot}</span>
									<Input
										value={state.jiraLabels[slot] ?? ''}
										onChange={(e) =>
											dispatch({
												type: 'SET_JIRA_LABEL',
												key: slot,
												value: e.target.value,
											})
										}
										placeholder={`JIRA label for ${slot}`}
										className="flex-1"
									/>
								</div>
							))}
						</div>

						{/* Cost custom field */}
						<div className="space-y-2">
							<Label>Custom Field: Cost</Label>
							{state.jiraProjectDetails ? (
								<FieldMappingRow
									slotLabel="cost"
									options={state.jiraProjectDetails.fields.map((f) => ({
										label: `${f.name} (${f.id})`,
										value: f.id,
									}))}
									value={state.jiraCostFieldId}
									onChange={(v) => dispatch({ type: 'SET_JIRA_COST_FIELD', id: v })}
									manualFallback
								/>
							) : (
								<Input
									value={state.jiraCostFieldId}
									onChange={(e) =>
										dispatch({
											type: 'SET_JIRA_COST_FIELD',
											id: e.target.value,
										})
									}
									placeholder="e.g., customfield_10042"
								/>
							)}
						</div>
					</div>
				)}
			</WizardStep>

			{/* Step 5: Webhooks */}
			<WizardStep
				stepNumber={5}
				title={STEP_TITLES[4]}
				status={getStatus(5, step5Complete)}
				isOpen={openSteps.has(5)}
				onToggle={() => toggleStep(5)}
			>
				<div className="space-y-4">
					{webhooksQuery.isLoading ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" /> Loading webhooks...
						</div>
					) : activeWebhooks.length > 0 ? (
						<div className="space-y-2">
							<Label>Active Webhooks</Label>
							{activeWebhooks.map((w) => (
								<div
									key={w.id}
									className="flex items-center justify-between rounded-md border px-3 py-2"
								>
									<div className="flex items-center gap-2 text-sm">
										<span
											className={`inline-block h-2 w-2 rounded-full ${w.active ? 'bg-green-500' : 'bg-amber-500'}`}
										/>
										<span className="font-mono text-xs">{w.url}</span>
									</div>
									<button
										type="button"
										onClick={() => {
											// Extract base URL from callback URL
											const base = w.url.replace(/\/(trello|jira|github)\/webhook$/, '');
											deleteWebhookMutation.mutate(base);
										}}
										disabled={deleteWebhookMutation.isPending}
										className="p-1 text-muted-foreground hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							))}
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-amber-600">
							<AlertCircle className="h-4 w-4" />
							No {state.provider === 'trello' ? 'Trello' : 'JIRA'} webhooks configured for this
							project.
						</div>
					)}

					<div className="space-y-2">
						<Label>Callback Base URL</Label>
						<p className="text-xs text-muted-foreground">
							The base URL where CASCADE receives webhooks. The{' '}
							{state.provider === 'trello' ? '/trello/webhook' : '/jira/webhook'} path is appended
							automatically.
						</p>
						<div className="flex gap-2">
							<Input
								value={webhookUrl}
								onChange={(e) => setWebhookUrl(e.target.value)}
								placeholder="https://cascade.example.com"
							/>
							<button
								type="button"
								onClick={() => createWebhookMutation.mutate()}
								disabled={!webhookUrl || createWebhookMutation.isPending}
								className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
							>
								{createWebhookMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<ExternalLink className="h-4 w-4" />
								)}
								Create Webhook
							</button>
						</div>
						{createWebhookMutation.isError && (
							<p className="text-sm text-destructive">{createWebhookMutation.error.message}</p>
						)}
						{createWebhookMutation.isSuccess && (
							<p className="text-sm text-green-600">Webhook created successfully.</p>
						)}
					</div>
				</div>
			</WizardStep>

			{/* Step 6: Save */}
			<WizardStep
				stepNumber={6}
				title={STEP_TITLES[5]}
				status={getStatus(6, saveMutation.isSuccess)}
				isOpen={openSteps.has(6)}
				onToggle={() => toggleStep(6)}
			>
				<div className="space-y-4">
					{/* Summary */}
					<div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Provider</span>
							<span className="font-medium">{state.provider === 'trello' ? 'Trello' : 'JIRA'}</span>
						</div>
						{state.verificationResult && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">Identity</span>
								<span className="font-medium">{state.verificationResult.display}</span>
							</div>
						)}
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								{state.provider === 'trello' ? 'Board' : 'Project'}
							</span>
							<span className="font-medium">
								{state.provider === 'trello'
									? state.trelloBoards.find((b) => b.id === state.trelloBoardId)?.name ||
										state.trelloBoardId
									: state.jiraProjects.find((p) => p.key === state.jiraProjectKey)?.name ||
										state.jiraProjectKey}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								{state.provider === 'trello' ? 'Lists mapped' : 'Statuses mapped'}
							</span>
							<span className="font-medium">
								{state.provider === 'trello'
									? Object.keys(state.trelloListMappings).filter((k) => state.trelloListMappings[k])
											.length
									: Object.keys(state.jiraStatusMappings).filter((k) => state.jiraStatusMappings[k])
											.length}
							</span>
						</div>
					</div>

					<p className="text-xs text-muted-foreground">
						Trigger configuration is managed separately in the <strong>Agent Configs</strong> tab.
					</p>

					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => saveMutation.mutate()}
							disabled={saveMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{saveMutation.isPending
								? 'Saving...'
								: state.isEditing
									? 'Update Integration'
									: 'Save Integration'}
						</button>
						{saveMutation.isSuccess && (
							<span className="text-sm text-green-600">Integration saved successfully.</span>
						)}
						{saveMutation.isError && (
							<span className="text-sm text-destructive">{saveMutation.error.message}</span>
						)}
					</div>
				</div>
			</WizardStep>
		</div>
	);
}
