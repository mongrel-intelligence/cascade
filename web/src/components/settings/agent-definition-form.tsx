import { Badge } from '@/components/ui/badge.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
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
import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AgentDefinition {
	identity: {
		emoji: string;
		label: string;
		roleHint: string;
		initialMessage: string;
	};
	capabilities: {
		canEditFiles: boolean;
		canCreatePR: boolean;
		canUpdateChecklists: boolean;
		isReadOnly: boolean;
		canAccessEmail?: boolean;
	};
	tools: {
		sets: string[];
		sdkTools: string;
	};
	strategies: {
		contextPipeline: string[];
		taskPromptBuilder: string;
		gadgetBuilder: string;
		gadgetBuilderOptions?: { includeReviewComments?: boolean } | null;
	};
	backend: {
		enableStopHooks: boolean;
		needsGitHubToken: boolean;
		blockGitPush?: boolean;
		requiresPR?: boolean;
		preExecute?: string;
		postConfigure?: string;
	};
	compaction: string;
	hint: string;
	trailingMessage?: {
		includeDiagnostics?: boolean;
		includeTodoProgress?: boolean;
		includeGitStatus?: boolean;
		includePRStatus?: boolean;
		includeReminder?: boolean;
	} | null;
	integrations: {
		required: string[];
		optional: string[];
	};
}

interface DefinitionRow {
	agentType: string;
	definition: AgentDefinition;
	isBuiltin: boolean;
}

interface AgentDefinitionFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	existing?: DefinitionRow;
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
// Helper components
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
						onChange={(sets) => setDef((d) => ({ ...d, tools: { ...d.tools, sets } }))}
					/>
				) : (
					<div className="text-sm text-muted-foreground">Loading...</div>
				)}
			</div>
			<div className="space-y-1">
				<Label>SDK Tools</Label>
				<Select
					value={def.tools.sdkTools}
					onValueChange={(v) => setDef((d) => ({ ...d, tools: { ...d.tools, sdkTools: v } }))}
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
							setDef((d) => ({ ...d, strategies: { ...d.strategies, contextPipeline } }))
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
							setDef((d) => ({ ...d, strategies: { ...d.strategies, taskPromptBuilder: v } }))
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
							setDef((d) => ({ ...d, strategies: { ...d.strategies, gadgetBuilder: v } }))
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
						setDef((d) => ({ ...d, integrations: { ...d.integrations, required } }))
					}
				/>
			</div>
			<div className="space-y-2">
				<Label>Optional</Label>
				<MultiSelectBadges
					available={integrationOptions}
					selected={def.integrations.optional}
					onChange={(optional) =>
						setDef((d) => ({ ...d, integrations: { ...d.integrations, optional } }))
					}
				/>
			</div>
		</section>
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
	trailingMessage: null,
	integrations: { required: ['pm'], optional: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function AgentDefinitionFormDialog({
	open,
	onOpenChange,
	existing,
}: AgentDefinitionFormDialogProps) {
	const queryClient = useQueryClient();
	const isEdit = !!existing;

	const schemaQuery = useQuery(trpc.agentDefinitions.schema.queryOptions());
	const schema = schemaQuery.data;

	// ── local state ──────────────────────────────────────────────────────────
	const [agentType, setAgentType] = useState(existing?.agentType ?? '');
	const [def, setDef] = useState<AgentDefinition>(existing?.definition ?? EMPTY_DEFINITION);
	const [jsonText, setJsonText] = useState(
		existing
			? JSON.stringify(existing.definition, null, 2)
			: JSON.stringify(EMPTY_DEFINITION, null, 2),
	);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState('form');

	// ── helpers ───────────────────────────────────────────────────────────────
	const queryKey = trpc.agentDefinitions.list.queryOptions().queryKey;

	const onSuccess = () => {
		queryClient.invalidateQueries({ queryKey });
		onOpenChange(false);
	};

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentDefinitions.create.mutate({ agentType, definition: def as never }),
		onSuccess,
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentDefinitions.update.mutate({
				agentType: existing?.agentType as string,
				patch: def as never,
			}),
		onSuccess,
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

	const handleTabChange = (tab: string) => {
		if (tab === 'json' && activeTab === 'form') {
			setJsonText(JSON.stringify(def, null, 2));
			setJsonError(null);
		}
		setActiveTab(tab);
	};

	const syncJsonToForm = () => {
		try {
			const parsed = JSON.parse(jsonText) as AgentDefinition;
			setDef(parsed);
			setJsonError(null);
			return true;
		} catch (e) {
			setJsonError((e as Error).message);
			return false;
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (activeTab === 'json') {
			if (!syncJsonToForm()) return;
			setTimeout(() => activeMutation.mutate(), 0);
			return;
		}
		activeMutation.mutate();
	};

	// ── field helpers ─────────────────────────────────────────────────────────
	const setIdentity = (k: keyof AgentDefinition['identity'], v: string) =>
		setDef((d) => ({ ...d, identity: { ...d.identity, [k]: v } }));

	const setCap = (k: keyof AgentDefinition['capabilities'], v: boolean) =>
		setDef((d) => ({ ...d, capabilities: { ...d.capabilities, [k]: v } }));

	const setBackend = (k: keyof AgentDefinition['backend'], v: unknown) =>
		setDef((d) => ({ ...d, backend: { ...d.backend, [k]: v } }));

	const setTrailing = (k: string, v: boolean) =>
		setDef((d) => ({ ...d, trailingMessage: { ...(d.trailingMessage ?? {}), [k]: v } }));

	// ─────────────────────────────────────────────────────────────────────────
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? `Edit Definition: ${existing.agentType}` : 'New Agent Definition'}
					</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{!isEdit && (
						<div className="space-y-2">
							<Label htmlFor="ad-agentType">Agent Type</Label>
							<Input
								id="ad-agentType"
								value={agentType}
								onChange={(e) => setAgentType(e.target.value)}
								placeholder="e.g. implementation, review, debug"
								required
							/>
						</div>
					)}

					<Tabs value={activeTab} onValueChange={handleTabChange}>
						<TabsList>
							<TabsTrigger value="form">Form</TabsTrigger>
							<TabsTrigger value="json">Raw JSON</TabsTrigger>
						</TabsList>

						<TabsContent value="form" className="space-y-6 pt-2">
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
										onValueChange={(v) => setDef((d) => ({ ...d, compaction: v }))}
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

						<TabsContent value="json" className="space-y-2 pt-2">
							<p className="text-sm text-muted-foreground">
								Edit the raw JSON. Changes here are applied when you save.
							</p>
							<Textarea
								value={jsonText}
								onChange={(e) => {
									setJsonText(e.target.value);
									setJsonError(null);
								}}
								rows={20}
								className="font-mono text-xs"
								spellCheck={false}
							/>
							{jsonError && (
								<p className="text-sm text-destructive">JSON parse error: {jsonError}</p>
							)}
						</TabsContent>
					</Tabs>

					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={activeMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{activeMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
						</button>
					</div>

					{activeMutation.isError && (
						<p className="text-sm text-destructive">{activeMutation.error.message}</p>
					)}
					{activeMutation.isSuccess && (
						<p className="text-sm text-green-600">Saved successfully.</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
