import type { AppRouter } from '@/../../src/api/router.js';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { useEffect, useState } from 'react';
import { ReferencePanel } from './prompt-editor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RouterOutput = inferRouterOutputs<AppRouter>;
type DefinitionRow = RouterOutput['agentDefinitions']['list'][number];
type AgentDefinition = DefinitionRow['definition'];

export interface AgentDefinitionEditorProps {
	/** When provided, we are editing an existing definition. When undefined, we are creating a new one. */
	existing?: DefinitionRow;
	onClose: () => void;
}

interface SchemaData {
	toolSetNames: readonly string[];
	sdkToolsNames: readonly string[];
	contextStepNames: readonly string[];
	taskPromptBuilderNames: readonly string[];
	gadgetBuilderNames: readonly string[];
	compactionNames: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components (shared with form dialog)
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
}) {
	return (
		<div className="flex cursor-pointer select-none items-center gap-2">
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
					checked ? 'bg-primary' : 'bg-input'
				}`}
			>
				<span
					className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
						checked ? 'translate-x-4.5' : 'translate-x-0.5'
					}`}
				/>
			</button>
			<span className="text-sm">{label}</span>
		</div>
	);
}

function MultiSelectBadges({
	available,
	selected,
	onChange,
}: {
	available: readonly string[];
	selected: string[];
	onChange: (v: string[]) => void;
}) {
	const toggle = (item: string) => {
		if (selected.includes(item)) {
			onChange(selected.filter((s) => s !== item));
		} else {
			onChange([...selected, item]);
		}
	};
	return (
		<div className="flex flex-wrap gap-1.5">
			{available.map((item) => (
				<button
					key={item}
					type="button"
					onClick={() => toggle(item)}
					className="focus:outline-none"
				>
					<Badge
						variant={selected.includes(item) ? 'default' : 'outline'}
						className="cursor-pointer text-xs hover:opacity-80"
					>
						{item}
					</Badge>
				</button>
			))}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Form section sub-components
// ─────────────────────────────────────────────────────────────────────────────

function IdentitySection({
	def,
	setIdentity,
}: {
	def: AgentDefinition;
	setIdentity: (k: keyof AgentDefinition['identity'], v: string) => void;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Identity
			</h3>
			<div className="grid grid-cols-2 gap-3">
				<div className="space-y-1">
					<Label htmlFor="ad-emoji">Emoji</Label>
					<Input
						id="ad-emoji"
						value={def.identity.emoji}
						onChange={(e) => setIdentity('emoji', e.target.value)}
						placeholder="🤖"
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="ad-label">Label</Label>
					<Input
						id="ad-label"
						value={def.identity.label}
						onChange={(e) => setIdentity('label', e.target.value)}
						placeholder="My Agent"
					/>
				</div>
			</div>
			<div className="space-y-1">
				<Label htmlFor="ad-roleHint">Role Hint</Label>
				<Textarea
					id="ad-roleHint"
					value={def.identity.roleHint}
					onChange={(e) => setIdentity('roleHint', e.target.value)}
					rows={3}
					placeholder="Describe the agent's role..."
				/>
			</div>
			<div className="space-y-1">
				<Label htmlFor="ad-initialMessage">Initial Message</Label>
				<Textarea
					id="ad-initialMessage"
					value={def.identity.initialMessage}
					onChange={(e) => setIdentity('initialMessage', e.target.value)}
					rows={2}
					placeholder="Starting message shown to the agent..."
				/>
			</div>
		</section>
	);
}

function CapabilitiesSection({
	def,
	setCap,
}: {
	def: AgentDefinition;
	setCap: (k: keyof AgentDefinition['capabilities'], v: boolean) => void;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Capabilities
			</h3>
			<div className="grid grid-cols-2 gap-2">
				<Toggle
					checked={def.capabilities.canEditFiles}
					onChange={(v) => setCap('canEditFiles', v)}
					label="Can Edit Files"
				/>
				<Toggle
					checked={def.capabilities.canCreatePR}
					onChange={(v) => setCap('canCreatePR', v)}
					label="Can Create PR"
				/>
				<Toggle
					checked={def.capabilities.canUpdateChecklists}
					onChange={(v) => setCap('canUpdateChecklists', v)}
					label="Can Update Checklists"
				/>
				<Toggle
					checked={def.capabilities.isReadOnly}
					onChange={(v) => setCap('isReadOnly', v)}
					label="Is Read Only"
				/>
				<Toggle
					checked={def.capabilities.canAccessEmail ?? false}
					onChange={(v) => setCap('canAccessEmail', v)}
					label="Can Access Email"
				/>
			</div>
		</section>
	);
}

function ToolsSection({
	def,
	setDef,
	schema,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
	schema: SchemaData | undefined;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tools</h3>
			<div className="space-y-2">
				<Label>Tool Sets</Label>
				{schema ? (
					<MultiSelectBadges
						available={schema.toolSetNames}
						selected={def.tools.sets}
						onChange={(sets) =>
							setDef((d) => ({ ...d, tools: { ...d.tools, sets } }) as AgentDefinition)
						}
					/>
				) : (
					<div className="text-sm text-muted-foreground">Loading...</div>
				)}
			</div>
			<div className="space-y-1">
				<Label>SDK Tools</Label>
				<Select
					value={def.tools.sdkTools}
					onValueChange={(v) =>
						setDef((d) => ({ ...d, tools: { ...d.tools, sdkTools: v } }) as AgentDefinition)
					}
				>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(schema?.sdkToolsNames ?? ['all', 'readOnly']).map((n) => (
							<SelectItem key={n} value={n}>
								{n}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</section>
	);
}

function StrategiesSection({
	def,
	setDef,
	schema,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
	schema: SchemaData | undefined;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Strategies
			</h3>
			<div className="space-y-2">
				<Label>Context Pipeline</Label>
				{schema ? (
					<MultiSelectBadges
						available={schema.contextStepNames}
						selected={def.strategies.contextPipeline}
						onChange={(contextPipeline) =>
							setDef(
								(d) =>
									({ ...d, strategies: { ...d.strategies, contextPipeline } }) as AgentDefinition,
							)
						}
					/>
				) : (
					<div className="text-sm text-muted-foreground">Loading...</div>
				)}
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div className="space-y-1">
					<Label>Task Prompt Builder</Label>
					<Select
						value={def.strategies.taskPromptBuilder}
						onValueChange={(v) =>
							setDef(
								(d) =>
									({
										...d,
										strategies: { ...d.strategies, taskPromptBuilder: v },
									}) as AgentDefinition,
							)
						}
					>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(schema?.taskPromptBuilderNames ?? []).map((n) => (
								<SelectItem key={n} value={n}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label>Gadget Builder</Label>
					<Select
						value={def.strategies.gadgetBuilder}
						onValueChange={(v) =>
							setDef(
								(d) =>
									({ ...d, strategies: { ...d.strategies, gadgetBuilder: v } }) as AgentDefinition,
							)
						}
					>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(schema?.gadgetBuilderNames ?? []).map((n) => (
								<SelectItem key={n} value={n}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</section>
	);
}

function BackendSection({
	def,
	setBackend,
}: {
	def: AgentDefinition;
	setBackend: (k: keyof AgentDefinition['backend'], v: unknown) => void;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Backend
			</h3>
			<div className="grid grid-cols-2 gap-2">
				<Toggle
					checked={def.backend.enableStopHooks}
					onChange={(v) => setBackend('enableStopHooks', v)}
					label="Enable Stop Hooks"
				/>
				<Toggle
					checked={def.backend.needsGitHubToken}
					onChange={(v) => setBackend('needsGitHubToken', v)}
					label="Needs GitHub Token"
				/>
				<Toggle
					checked={def.backend.blockGitPush ?? false}
					onChange={(v) => setBackend('blockGitPush', v)}
					label="Block Git Push"
				/>
				<Toggle
					checked={def.backend.requiresPR ?? false}
					onChange={(v) => setBackend('requiresPR', v)}
					label="Requires PR"
				/>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div className="space-y-1">
					<Label>Pre-Execute Hook</Label>
					<Select
						value={def.backend.preExecute ?? '_none'}
						onValueChange={(v) => setBackend('preExecute', v === '_none' ? undefined : v)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="None" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="_none">None</SelectItem>
							<SelectItem value="postInitialPRComment">postInitialPRComment</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label>Post-Configure Hook</Label>
					<Select
						value={def.backend.postConfigure ?? '_none'}
						onValueChange={(v) => setBackend('postConfigure', v === '_none' ? undefined : v)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="None" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="_none">None</SelectItem>
							<SelectItem value="sequentialGadgetExecution">sequentialGadgetExecution</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		</section>
	);
}

function TrailingMessageSection({
	def,
	setTrailing,
}: {
	def: AgentDefinition;
	setTrailing: (k: string, v: boolean) => void;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Trailing Message
			</h3>
			<div className="grid grid-cols-2 gap-2">
				<Toggle
					checked={def.trailingMessage?.includeDiagnostics ?? false}
					onChange={(v) => setTrailing('includeDiagnostics', v)}
					label="Include Diagnostics"
				/>
				<Toggle
					checked={def.trailingMessage?.includeTodoProgress ?? false}
					onChange={(v) => setTrailing('includeTodoProgress', v)}
					label="Include Todo Progress"
				/>
				<Toggle
					checked={def.trailingMessage?.includeGitStatus ?? false}
					onChange={(v) => setTrailing('includeGitStatus', v)}
					label="Include Git Status"
				/>
				<Toggle
					checked={def.trailingMessage?.includePRStatus ?? false}
					onChange={(v) => setTrailing('includePRStatus', v)}
					label="Include PR Status"
				/>
				<Toggle
					checked={def.trailingMessage?.includeReminder ?? false}
					onChange={(v) => setTrailing('includeReminder', v)}
					label="Include Reminder"
				/>
			</div>
		</section>
	);
}

function IntegrationsSection({
	def,
	setDef,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
}) {
	const integrationOptions = ['pm', 'scm', 'email', 'sms'] as const;
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Integrations
			</h3>
			<div className="space-y-2">
				<Label>Required</Label>
				<MultiSelectBadges
					available={integrationOptions}
					selected={def.integrations.required}
					onChange={(required) =>
						setDef(
							(d) => ({ ...d, integrations: { ...d.integrations, required } }) as AgentDefinition,
						)
					}
				/>
			</div>
			<div className="space-y-2">
				<Label>Optional</Label>
				<MultiSelectBadges
					available={integrationOptions}
					selected={def.integrations.optional}
					onChange={(optional) =>
						setDef(
							(d) => ({ ...d, integrations: { ...d.integrations, optional } }) as AgentDefinition,
						)
					}
				/>
			</div>
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt panel (edit mode only)
// ─────────────────────────────────────────────────────────────────────────────

function SystemPromptPanel({ agentType }: { agentType: string }) {
	const queryClient = useQueryClient();
	const [content, setContent] = useState('');
	const [validationStatus, setValidationStatus] = useState<string | null>(null);

	const definitionQuery = useQuery(trpc.agentDefinitions.get.queryOptions({ agentType }));
	const defaultQuery = useQuery(trpc.prompts.getDefault.queryOptions({ agentType }));
	const variablesQuery = useQuery(trpc.prompts.variables.queryOptions());
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const definition = definitionQuery.data?.definition;
	const hasCustom = !!definition?.prompts?.systemPrompt;

	useEffect(() => {
		if (definition?.prompts?.systemPrompt) {
			setContent(definition.prompts.systemPrompt);
		} else if (defaultQuery.data) {
			setContent(defaultQuery.data.content);
		}
	}, [definition?.prompts?.systemPrompt, defaultQuery.data]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			await trpcClient.agentDefinitions.updatePrompt.mutate({
				agentType,
				systemPrompt: content,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.get.queryOptions({ agentType }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.list.queryOptions().queryKey,
			});
			setValidationStatus('Saved.');
		},
	});

	const resetMutation = useMutation({
		mutationFn: async () => {
			await trpcClient.agentDefinitions.resetPrompt.mutate({ agentType });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.get.queryOptions({ agentType }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.list.queryOptions().queryKey,
			});
			if (defaultQuery.data) {
				setContent(defaultQuery.data.content);
			}
			setValidationStatus('Reset to default.');
		},
	});

	const validateMutation = useMutation({
		mutationFn: () => trpcClient.prompts.validate.mutate({ template: content }),
		onSuccess: (result) => {
			if (result.valid) {
				setValidationStatus('Valid.');
			} else {
				setValidationStatus(`Invalid: ${result.error}`);
			}
		},
	});

	function loadDefault() {
		if (defaultQuery.data) {
			setContent(defaultQuery.data.content);
			setValidationStatus(null);
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">
						System prompt for <span className="font-mono font-medium">{agentType}</span>
					</span>
					{hasCustom && <Badge>custom</Badge>}
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => resetMutation.mutate()}
						disabled={!hasCustom || resetMutation.isPending}
						className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
					>
						Reset to Default
					</button>
					<button
						type="button"
						onClick={() => saveMutation.mutate()}
						disabled={saveMutation.isPending}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{saveMutation.isPending ? 'Saving...' : 'Save Prompt'}
					</button>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 space-y-2">
					<textarea
						value={content}
						onChange={(e) => {
							setContent(e.target.value);
							setValidationStatus(null);
						}}
						className="w-full h-[500px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
						spellCheck={false}
					/>
					<div className="flex items-center gap-4">
						<button
							type="button"
							onClick={loadDefault}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Load Default
						</button>
						<button
							type="button"
							onClick={() => validateMutation.mutate()}
							disabled={validateMutation.isPending}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Validate
						</button>
						{validationStatus && (
							<span
								className={`text-sm ${
									validationStatus.startsWith('Invalid')
										? 'text-destructive'
										: 'text-green-600 dark:text-green-400'
								}`}
							>
								{validationStatus}
							</span>
						)}
						{saveMutation.isError && (
							<span className="text-sm text-destructive">{saveMutation.error.message}</span>
						)}
					</div>
				</div>

				<ReferencePanel variables={variablesQuery.data} partials={partialsQuery.data} />
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default empty definition for "create" mode
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_DEFINITION: AgentDefinition = {
	identity: { emoji: '🤖', label: '', roleHint: '', initialMessage: '' },
	capabilities: {
		canEditFiles: false,
		canCreatePR: false,
		canUpdateChecklists: false,
		isReadOnly: true,
		canAccessEmail: false,
	},
	tools: { sets: [], sdkTools: 'readOnly' },
	strategies: {
		contextPipeline: [],
		taskPromptBuilder: 'workItem',
		gadgetBuilder: 'workItem',
	},
	backend: { enableStopHooks: false, needsGitHubToken: false },
	compaction: 'default',
	hint: '',
	trailingMessage: undefined,
	integrations: { required: ['pm'], optional: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook — encapsulates all editor state and mutations
// ─────────────────────────────────────────────────────────────────────────────

function useDefinitionEditor(existing: DefinitionRow | undefined, onClose: () => void) {
	const queryClient = useQueryClient();
	const isEdit = !!existing;
	const queryKey = trpc.agentDefinitions.list.queryOptions().queryKey;

	const [agentType, setAgentType] = useState(existing?.agentType ?? '');
	const [def, setDef] = useState<AgentDefinition>(existing?.definition ?? EMPTY_DEFINITION);
	const [jsonText, setJsonText] = useState(
		existing
			? JSON.stringify(existing.definition, null, 2)
			: JSON.stringify(EMPTY_DEFINITION, null, 2),
	);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState('definition');

	const onSuccess = () => {
		queryClient.invalidateQueries({ queryKey });
		onClose();
	};

	const createMutation = useMutation({
		mutationFn: (params: { agentType: string; definition: AgentDefinition }) =>
			trpcClient.agentDefinitions.create.mutate(params),
		onSuccess,
	});

	const updateMutation = useMutation({
		mutationFn: (params: { agentType: string; patch: AgentDefinition }) =>
			trpcClient.agentDefinitions.update.mutate(params),
		onSuccess,
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

	const handleTabChange = (tab: string) => {
		if (tab === 'json' && activeTab === 'definition') {
			setJsonText(JSON.stringify(def, null, 2));
			setJsonError(null);
		} else if (tab === 'definition' && activeTab === 'json') {
			try {
				setDef(JSON.parse(jsonText) as AgentDefinition);
				setJsonError(null);
			} catch (err) {
				setJsonError((err as Error).message);
				return; // keep user on JSON tab so they can fix the error
			}
		}
		setActiveTab(tab);
	};

	const handleSave = () => {
		if (!isEdit && !agentType.trim()) return;

		let submission = def;
		if (activeTab === 'json') {
			try {
				submission = JSON.parse(jsonText) as AgentDefinition;
				setDef(submission);
				setJsonError(null);
			} catch (err) {
				setJsonError((err as Error).message);
				return;
			}
		}
		if (isEdit && existing) {
			updateMutation.mutate({ agentType: existing.agentType, patch: submission });
		} else {
			createMutation.mutate({ agentType, definition: submission });
		}
	};

	const setIdentity = (k: keyof AgentDefinition['identity'], v: string) =>
		setDef((d) => ({ ...d, identity: { ...d.identity, [k]: v } }));
	const setCap = (k: keyof AgentDefinition['capabilities'], v: boolean) =>
		setDef((d) => ({ ...d, capabilities: { ...d.capabilities, [k]: v } }));
	const setBackend = (k: keyof AgentDefinition['backend'], v: unknown) =>
		setDef((d) => ({ ...d, backend: { ...d.backend, [k]: v } }));
	const setTrailing = (k: string, v: boolean) =>
		setDef((d) => ({ ...d, trailingMessage: { ...(d.trailingMessage ?? {}), [k]: v } }));

	const clearJsonError = () => setJsonError(null);

	return {
		isEdit,
		agentType,
		setAgentType,
		def,
		setDef,
		jsonText,
		setJsonText,
		jsonError,
		clearJsonError,
		activeTab,
		activeMutation,
		handleTabChange,
		handleSave,
		setIdentity,
		setCap,
		setBackend,
		setTrailing,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Main full-screen editor component
// ─────────────────────────────────────────────────────────────────────────────

export function AgentDefinitionEditor({ existing, onClose }: AgentDefinitionEditorProps) {
	const schemaQuery = useQuery(trpc.agentDefinitions.schema.queryOptions());
	const schema = schemaQuery.data;

	const {
		isEdit,
		agentType,
		setAgentType,
		def,
		setDef,
		jsonText,
		setJsonText,
		jsonError,
		clearJsonError,
		activeTab,
		activeMutation,
		handleTabChange,
		handleSave,
		setIdentity,
		setCap,
		setBackend,
		setTrailing,
	} = useDefinitionEditor(existing, onClose);

	// ─────────────────────────────────────────────────────────────────────────
	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-bold">
						{isEdit ? (
							<>
								{existing?.definition.identity.emoji}{' '}
								<span className="font-mono">{existing?.agentType}</span>
							</>
						) : (
							'New Agent Definition'
						)}
					</h2>
					{isEdit && (
						<p className="text-sm text-muted-foreground">{existing?.definition.identity.label}</p>
					)}
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={onClose}
						className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
					>
						Cancel
					</button>
					{/* Save is only shown for Definition / Raw JSON tabs (not System Prompt which has its own save) */}
					{activeTab !== 'prompt' && (
						<button
							type="button"
							onClick={handleSave}
							disabled={activeMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{activeMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
						</button>
					)}
				</div>
			</div>

			{/* Agent Type input for create mode */}
			{!isEdit && (
				<div className="space-y-2">
					<Label htmlFor="ad-agentType">Agent Type</Label>
					<Input
						id="ad-agentType"
						value={agentType}
						onChange={(e) => setAgentType(e.target.value)}
						placeholder="e.g. implementation, review, debug"
					/>
				</div>
			)}

			{activeMutation.isError && (
				<p className="text-sm text-destructive">{activeMutation.error.message}</p>
			)}

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<TabsList>
					<TabsTrigger value="definition">Definition</TabsTrigger>
					{isEdit && <TabsTrigger value="prompt">System Prompt</TabsTrigger>}
					<TabsTrigger value="json">Raw JSON</TabsTrigger>
				</TabsList>

				<TabsContent value="definition" className="space-y-6 pt-4">
					<IdentitySection def={def} setIdentity={setIdentity} />
					<CapabilitiesSection def={def} setCap={setCap} />
					<ToolsSection def={def} setDef={setDef} schema={schema} />
					<StrategiesSection def={def} setDef={setDef} schema={schema} />
					<BackendSection def={def} setBackend={setBackend} />

					<section className="space-y-3">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Compaction
						</h3>
						<div className="space-y-1">
							<Label>Compaction Strategy</Label>
							<Select
								value={def.compaction}
								onValueChange={(v) => setDef((d) => ({ ...d, compaction: v }) as AgentDefinition)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(schema?.compactionNames ?? ['implementation', 'default']).map((n) => (
										<SelectItem key={n} value={n}>
											{n}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</section>

					<section className="space-y-3">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Hint
						</h3>
						<div className="space-y-1">
							<Label htmlFor="ad-hint">Hint Text</Label>
							<Textarea
								id="ad-hint"
								value={def.hint}
								onChange={(e) => setDef((d) => ({ ...d, hint: e.target.value }))}
								rows={2}
								placeholder="Optional hint shown in iteration messages..."
							/>
						</div>
					</section>

					<TrailingMessageSection def={def} setTrailing={setTrailing} />
					<IntegrationsSection def={def} setDef={setDef} />
				</TabsContent>

				{isEdit && (
					<TabsContent value="prompt" className="pt-4">
						<SystemPromptPanel agentType={existing?.agentType ?? ''} />
					</TabsContent>
				)}

				<TabsContent value="json" className="space-y-2 pt-4">
					<p className="text-sm text-muted-foreground">
						Edit the raw JSON. Changes here are applied when you save.
					</p>
					<Textarea
						value={jsonText}
						onChange={(e) => {
							setJsonText(e.target.value);
							clearJsonError();
						}}
						rows={30}
						className="font-mono text-xs"
						spellCheck={false}
					/>
					{jsonError && <p className="text-sm text-destructive">JSON parse error: {jsonError}</p>}
				</TabsContent>
			</Tabs>
		</div>
	);
}
