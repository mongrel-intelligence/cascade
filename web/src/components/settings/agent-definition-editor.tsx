import type { AppRouter } from '@/../../src/api/router.js';
import {
	type KnownTriggerEvent,
	TRIGGER_CATEGORY_LABELS,
} from '@/../../src/api/routers/_shared/triggerTypes.js';
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReferencePanel } from './prompt-editor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RouterOutput = inferRouterOutputs<AppRouter>;
type DefinitionRow = RouterOutput['agentDefinitions']['list'][number];
type AgentDefinition = DefinitionRow['definition'];
type Capability = AgentDefinition['capabilities']['required'][number];

export interface AgentDefinitionEditorProps {
	/** When provided, we are editing an existing definition. When undefined, we are creating a new one. */
	existing?: DefinitionRow;
	onClose: () => void;
}

interface SchemaData {
	capabilities: readonly string[];
	triggerRegistry: Record<string, KnownTriggerEvent[]>;
}

// All available capabilities organized by integration
const CAPABILITY_GROUPS: Record<string, { label: string; caps: Capability[] }> = {
	'built-in': {
		label: 'Built-in (always available)',
		caps: ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl'],
	},
	pm: {
		label: 'PM Integration (Trello/JIRA)',
		caps: ['pm:read', 'pm:write', 'pm:checklist'],
	},
	scm: {
		label: 'SCM Integration (GitHub)',
		caps: ['scm:read', 'scm:comment', 'scm:review', 'scm:pr'],
	},
	email: {
		label: 'Email Integration',
		caps: ['email:read', 'email:write'],
	},
	sms: {
		label: 'SMS Integration (Twilio)',
		caps: ['sms:send'],
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper components (shared with form dialog)
// ─────────────────────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
					<Info className="h-3.5 w-3.5" />
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">{text}</TooltipContent>
		</Tooltip>
	);
}

function Toggle({
	checked,
	onChange,
	label,
	description,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
	description?: string;
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
			{description && <InfoTooltip text={description} />}
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
	setDef,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
}) {
	const toggleCapability = (cap: Capability, inRequired: boolean) => {
		setDef((d) => {
			const required = [...d.capabilities.required];
			const optional = [...d.capabilities.optional];

			// Remove from both arrays first
			const reqIdx = required.indexOf(cap);
			const optIdx = optional.indexOf(cap);
			if (reqIdx !== -1) required.splice(reqIdx, 1);
			if (optIdx !== -1) optional.splice(optIdx, 1);

			// Add to the appropriate array
			if (inRequired) {
				required.push(cap);
			} else {
				optional.push(cap);
			}

			return { ...d, capabilities: { required, optional } };
		});
	};

	const removeCapability = (cap: Capability) => {
		setDef((d) => ({
			...d,
			capabilities: {
				required: d.capabilities.required.filter((c) => c !== cap),
				optional: d.capabilities.optional.filter((c) => c !== cap),
			},
		}));
	};

	const isRequired = (cap: Capability) => def.capabilities.required.includes(cap);
	const isOptional = (cap: Capability) => def.capabilities.optional.includes(cap);
	const isEnabled = (cap: Capability) => isRequired(cap) || isOptional(cap);

	return (
		<section className="space-y-4">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Capabilities
			</h3>
			<p className="text-sm text-muted-foreground">
				Select capabilities this agent needs. Required capabilities must be available; optional
				capabilities are used when their integration is configured.
			</p>

			{Object.entries(CAPABILITY_GROUPS).map(([groupKey, { label, caps }]) => (
				<div key={groupKey} className="space-y-2 rounded-md border border-border p-3">
					<div className="text-sm font-medium">{label}</div>
					<div className="grid grid-cols-2 gap-2">
						{caps.map((cap) => (
							<div key={cap} className="flex items-center gap-2">
								<input
									type="checkbox"
									id={`cap-${cap}`}
									checked={isEnabled(cap)}
									onChange={(e) => {
										if (e.target.checked) {
											toggleCapability(cap, true);
										} else {
											removeCapability(cap);
										}
									}}
									className="h-4 w-4 rounded border-input"
								/>
								<label htmlFor={`cap-${cap}`} className="flex-1 text-sm">
									{cap}
								</label>
								{isEnabled(cap) && (
									<select
										value={isRequired(cap) ? 'required' : 'optional'}
										onChange={(e) => toggleCapability(cap, e.target.value === 'required')}
										className="h-6 rounded border border-input bg-background px-1 text-xs"
									>
										<option value="required">required</option>
										<option value="optional">optional</option>
									</select>
								)}
							</div>
						))}
					</div>
				</div>
			))}

			<div className="rounded-md bg-muted/50 p-3 text-sm">
				<div className="font-medium">Derived Configuration</div>
				<div className="mt-1 text-muted-foreground">
					Required integrations:{' '}
					{[
						...new Set(
							def.capabilities.required
								.filter(
									(c) =>
										!c.startsWith('fs:') && !c.startsWith('shell:') && !c.startsWith('session:'),
								)
								.map((c) => c.split(':')[0]),
						),
					].join(', ') || 'none'}
				</div>
			</div>
		</section>
	);
}

function StrategiesSection({
	def,
	setDef,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
}) {
	// Only show strategies section if gadgetOptions is set
	if (!def.strategies.gadgetOptions) {
		return null;
	}

	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Strategies
			</h3>
			<div className="space-y-2">
				<Label>Gadget Options</Label>
				<Toggle
					checked={def.strategies.gadgetOptions.includeReviewComments ?? false}
					onChange={(v) =>
						setDef(
							(d) =>
								({
									...d,
									strategies: {
										...d.strategies,
										gadgetOptions: { ...d.strategies.gadgetOptions, includeReviewComments: v },
									},
								}) as AgentDefinition,
						)
					}
					label="Include Review Comments"
					description="Adds GetPRComments and ReplyToReviewComment gadgets for PR review interaction."
				/>
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
	// Helper to update a specific SCM hook field
	const setHook = (
		k: keyof NonNullable<NonNullable<AgentDefinition['backend']['hooks']>['scm']>,
		v: unknown,
	) => {
		setBackend('hooks', {
			...def.backend.hooks,
			scm: {
				...def.backend.hooks?.scm,
				[k]: v,
			},
		});
	};

	const scm = def.backend.hooks?.scm;

	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Backend
			</h3>

			{/* SCM Hooks */}
			<div className="rounded-md border border-border p-3 space-y-2">
				<div className="text-sm font-medium">SCM Hooks</div>
				<div className="grid grid-cols-2 gap-2">
					<Toggle
						checked={scm?.enableStopHooks ?? false}
						onChange={(v) => setHook('enableStopHooks', v)}
						label="Enable Stop Hooks"
						description="Checks for uncommitted/unpushed changes before agent finishes. Enable for implementation; disable for planning/review."
					/>
					<Toggle
						checked={scm?.blockGitPush ?? false}
						onChange={(v) => setHook('blockGitPush', v)}
						label="Block Git Push"
						description="Prevents direct pushes, requiring cascade-tools for PRs. Disable for existing PR branches."
					/>
					<Toggle
						checked={scm?.requiresPR ?? false}
						onChange={(v) => setHook('requiresPR', v)}
						label="Requires PR"
						description="Agent must create a PR before the session can finish."
					/>
					<Toggle
						checked={scm?.requiresReview ?? false}
						onChange={(v) => setHook('requiresReview', v)}
						label="Requires Review"
						description="Agent must submit a code review before the session can finish."
					/>
					<Toggle
						checked={scm?.requiresPushedChanges ?? false}
						onChange={(v) => setHook('requiresPushedChanges', v)}
						label="Requires Pushed Changes"
						description="Agent must commit and push changes before the session can finish."
					/>
				</div>
			</div>

			{/* Backend Settings */}
			<div className="rounded-md border border-border p-3 space-y-2">
				<div className="text-sm font-medium">Backend Settings</div>
				<Toggle
					checked={def.backend.needsGitHubToken}
					onChange={(v) => setBackend('needsGitHubToken', v)}
					label="Needs GitHub Token"
					description="Agent receives GitHub token for API access. Required for PR creation and code reviews."
				/>
			</div>

			<div className="grid grid-cols-1 gap-3">
				<div className="space-y-1">
					<div className="flex items-center gap-1.5">
						<Label>Post-Configure Hook</Label>
						<InfoTooltip text="Hook run after builder configuration. 'sequentialGadgetExecution' forces serial gadget execution." />
					</div>
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
					description="Appends lint/type-check errors and loop detection warnings to each iteration message."
				/>
				<Toggle
					checked={def.trailingMessage?.includeTodoProgress ?? false}
					onChange={(v) => setTrailing('includeTodoProgress', v)}
					label="Include Todo Progress"
					description="Appends the current todo checklist progress to each iteration message."
				/>
				<Toggle
					checked={def.trailingMessage?.includeGitStatus ?? false}
					onChange={(v) => setTrailing('includeGitStatus', v)}
					label="Include Git Status"
					description="Appends git status showing uncommitted changes to each iteration message."
				/>
				<Toggle
					checked={def.trailingMessage?.includePRStatus ?? false}
					onChange={(v) => setTrailing('includePRStatus', v)}
					label="Include PR Status"
					description="Appends PR view showing current state and checks to each iteration message."
				/>
				<Toggle
					checked={def.trailingMessage?.includeReminder ?? false}
					onChange={(v) => setTrailing('includeReminder', v)}
					label="Include Reminder"
					description="Appends an efficiency reminder to batch gadget calls in each iteration message."
				/>
			</div>
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Triggers Section
// ─────────────────────────────────────────────────────────────────────────────

function TriggersSection({
	def,
	setDef,
	schema,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
	schema: SchemaData | undefined;
}) {
	const enabledEvents = new Set(def.triggers.map((t) => t.event));

	const toggleTrigger = (known: KnownTriggerEvent, enabled: boolean) => {
		setDef((d) => {
			if (enabled) {
				// Add the trigger with minimal configuration
				// Type assertions needed because schema returns string[] but definition expects literal types
				const newTrigger: AgentDefinition['triggers'][number] = {
					event: known.event,
					label: known.label,
					description: known.description,
					defaultEnabled: true,
					parameters: [],
					...(known.providers
						? { providers: known.providers as AgentDefinition['triggers'][number]['providers'] }
						: {}),
					...(known.contextPipeline.length > 0
						? {
								contextPipeline:
									known.contextPipeline as AgentDefinition['triggers'][number]['contextPipeline'],
							}
						: {}),
				};
				return { ...d, triggers: [...d.triggers, newTrigger] };
			}
			// Remove the trigger
			return {
				...d,
				triggers: d.triggers.filter((t) => t.event !== known.event),
			};
		});
	};

	if (!schema?.triggerRegistry) {
		return (
			<section className="space-y-3">
				<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					Triggers
				</h3>
				<div className="text-sm text-muted-foreground">Loading trigger registry...</div>
			</section>
		);
	}

	const categories = ['pm', 'scm', 'email', 'sms'] as const;

	return (
		<section className="space-y-4">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Triggers
			</h3>
			<p className="text-sm text-muted-foreground">
				Select which events can activate this agent. Each trigger defines what event fires the agent
				and what context it provides.
			</p>

			{categories.map((category) => {
				const triggers = schema.triggerRegistry[category] ?? [];
				if (triggers.length === 0) return null;

				return (
					<div key={category} className="space-y-2 rounded-md border border-border p-3">
						<div className="text-sm font-medium">{TRIGGER_CATEGORY_LABELS[category]}</div>
						<div className="space-y-2">
							{triggers.map((known) => {
								const isEnabled = enabledEvents.has(known.event);
								return (
									<div
										key={known.event}
										className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50"
									>
										<input
											type="checkbox"
											id={`trigger-${known.event}`}
											checked={isEnabled}
											onChange={(e) => toggleTrigger(known, e.target.checked)}
											className="mt-0.5 h-4 w-4 rounded border-input"
										/>
										<div className="flex-1 space-y-1">
											<div className="flex items-center gap-2">
												<label
													htmlFor={`trigger-${known.event}`}
													className="text-sm font-medium cursor-pointer"
												>
													{known.label}
												</label>
												<span className="text-xs text-muted-foreground font-mono">
													({known.event})
												</span>
												{known.providers && known.providers.length > 0 && (
													<div className="flex gap-1">
														{known.providers.map((p) => (
															<Badge key={p} variant="secondary" className="text-xs">
																{p}
															</Badge>
														))}
													</div>
												)}
											</div>
											<div className="text-xs text-muted-foreground">{known.description}</div>
											{known.contextPipeline.length > 0 && (
												<div className="flex items-center gap-1 text-xs text-muted-foreground">
													<span className="text-primary/60">&rarr;</span>
													{known.contextPipeline.join(', ')}
												</div>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}

			{def.triggers.length > 0 && (
				<div className="rounded-md bg-muted/50 p-3 text-sm">
					<div className="font-medium">Selected Triggers ({def.triggers.length})</div>
					<div className="mt-1 flex flex-wrap gap-1">
						{def.triggers.map((t) => (
							<Badge key={t.event} variant="outline" className="text-xs">
								{t.event}
							</Badge>
						))}
					</div>
				</div>
			)}
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Prompts panel (edit mode only) - shows both system and task prompts
// ─────────────────────────────────────────────────────────────────────────────

function PromptSectionTab({
	label,
	isActive,
	hasCustom,
	onClick,
}: {
	label: string;
	isActive: boolean;
	hasCustom: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`pb-2 text-sm font-medium border-b-2 -mb-px ${
				isActive
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'
			}`}
		>
			{label}
			{hasCustom && (
				<Badge variant="secondary" className="ml-2 text-xs">
					custom
				</Badge>
			)}
		</button>
	);
}

function ValidationStatus({
	status,
	saveError,
}: {
	status: string | null;
	saveError: string | undefined;
}) {
	if (!status && !saveError) return null;
	const isInvalid = status?.startsWith('Invalid');
	return (
		<>
			{status && (
				<span
					className={`text-sm ${isInvalid ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}
				>
					{status}
				</span>
			)}
			{saveError && <span className="text-sm text-destructive">{saveError}</span>}
		</>
	);
}

function usePromptSync(
	definition: { prompts?: { systemPrompt?: string; taskPrompt?: string } } | undefined,
	defaultContent: string | undefined,
	setSystemPrompt: (v: string) => void,
	setTaskPrompt: (v: string) => void,
) {
	useEffect(() => {
		const customSystem = definition?.prompts?.systemPrompt;
		setSystemPrompt(customSystem || defaultContent || '');
	}, [definition?.prompts?.systemPrompt, defaultContent, setSystemPrompt]);

	useEffect(() => {
		const customTask = definition?.prompts?.taskPrompt;
		if (customTask) setTaskPrompt(customTask);
	}, [definition?.prompts?.taskPrompt, setTaskPrompt]);
}

function PromptEditorHeader({
	sectionLabel,
	agentType,
	hasCustom,
	hasAnyCustom,
	onReset,
	onSave,
	resetPending,
	savePending,
}: {
	sectionLabel: string;
	agentType: string;
	hasCustom: boolean;
	hasAnyCustom: boolean;
	onReset: () => void;
	onSave: () => void;
	resetPending: boolean;
	savePending: boolean;
}) {
	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground">
					{sectionLabel} prompt for <span className="font-mono font-medium">{agentType}</span>
				</span>
				{hasCustom && <Badge>custom</Badge>}
			</div>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onReset}
					disabled={!hasAnyCustom || resetPending}
					className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
				>
					Reset All Prompts
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={savePending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{savePending ? 'Saving...' : 'Save Prompt'}
				</button>
			</div>
		</div>
	);
}

function PromptsPanel({ agentType }: { agentType: string }) {
	const queryClient = useQueryClient();
	const [systemPrompt, setSystemPrompt] = useState('');
	const [taskPrompt, setTaskPrompt] = useState('');
	const [activeSection, setActiveSection] = useState<'system' | 'task'>('system');
	const [validationStatus, setValidationStatus] = useState<string | null>(null);

	const definitionQuery = useQuery(trpc.agentDefinitions.get.queryOptions({ agentType }));
	const defaultQuery = useQuery(trpc.prompts.getDefault.queryOptions({ agentType }));
	const systemVariablesQuery = useQuery(trpc.prompts.variables.queryOptions());
	const taskVariablesQuery = useQuery(trpc.prompts.taskVariables.queryOptions());
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const definition = definitionQuery.data?.definition;
	const hasCustomSystemPrompt = !!definition?.prompts?.systemPrompt;
	const hasCustomTaskPrompt = !!definition?.prompts?.taskPrompt;

	// Sync prompt state with definition/defaults
	usePromptSync(definition, defaultQuery.data?.content, setSystemPrompt, setTaskPrompt);

	const saveMutation = useMutation({
		mutationFn: async () => {
			// Always send both prompts to prevent losing the inactive section
			await trpcClient.agentDefinitions.updatePrompt.mutate({
				agentType,
				systemPrompt,
				taskPrompt,
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
				setSystemPrompt(defaultQuery.data.content);
			}
			setTaskPrompt('');
			setValidationStatus('Reset to default.');
		},
	});

	const validateMutation = useMutation({
		mutationFn: () =>
			trpcClient.prompts.validate.mutate({
				template: activeSection === 'system' ? systemPrompt : taskPrompt,
			}),
		onSuccess: (result) => {
			if (result.valid) {
				setValidationStatus('Valid.');
			} else {
				setValidationStatus(`Invalid: ${result.error}`);
			}
		},
	});

	function loadDefaultSystemPrompt() {
		if (defaultQuery.data) {
			setSystemPrompt(defaultQuery.data.content);
			setValidationStatus(null);
		}
	}

	const isSystemSection = activeSection === 'system';
	const currentContent = isSystemSection ? systemPrompt : taskPrompt;
	const setCurrentContent = isSystemSection ? setSystemPrompt : setTaskPrompt;
	const hasCustom = isSystemSection ? hasCustomSystemPrompt : hasCustomTaskPrompt;
	const variables = isSystemSection ? systemVariablesQuery.data : taskVariablesQuery.data;
	const sectionLabel = isSystemSection ? 'System' : 'Task';
	const placeholder = isSystemSection
		? 'Enter the system prompt template with Eta variables and <%~ include("partials/...") %> directives'
		: 'Enter the task prompt template with Eta variables like <%= it.cardId %>';

	// Loading state
	const isLoading = definitionQuery.isLoading || defaultQuery.isLoading;
	// Error state
	const queryError = definitionQuery.error || defaultQuery.error;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-muted-foreground">Loading prompts...</div>
			</div>
		);
	}

	if (queryError) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-destructive">Failed to load prompts: {queryError.message}</div>
			</div>
		);
	}

	const handleSectionChange = (section: 'system' | 'task') => {
		setActiveSection(section);
		setValidationStatus(null);
	};

	const handleReset = () => {
		if (!confirm('Reset both system and task prompts to their defaults?')) return;
		resetMutation.mutate();
	};

	return (
		<div className="space-y-4">
			{/* Section tabs */}
			<div className="flex items-center gap-4 border-b border-border">
				<PromptSectionTab
					label="System Prompt"
					isActive={activeSection === 'system'}
					hasCustom={hasCustomSystemPrompt}
					onClick={() => handleSectionChange('system')}
				/>
				<PromptSectionTab
					label="Task Prompt"
					isActive={activeSection === 'task'}
					hasCustom={hasCustomTaskPrompt}
					onClick={() => handleSectionChange('task')}
				/>
			</div>

			{/* Header with actions */}
			<PromptEditorHeader
				sectionLabel={sectionLabel}
				agentType={agentType}
				hasCustom={hasCustom}
				hasAnyCustom={hasCustomSystemPrompt || hasCustomTaskPrompt}
				onReset={handleReset}
				onSave={() => saveMutation.mutate()}
				resetPending={resetMutation.isPending}
				savePending={saveMutation.isPending}
			/>

			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 space-y-2">
					<textarea
						value={currentContent}
						onChange={(e) => {
							setCurrentContent(e.target.value);
							setValidationStatus(null);
						}}
						className="w-full h-[500px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
						spellCheck={false}
						placeholder={placeholder}
					/>
					<div className="flex items-center gap-4">
						{isSystemSection && (
							<button
								type="button"
								onClick={loadDefaultSystemPrompt}
								className="text-sm text-muted-foreground hover:text-foreground"
							>
								Load Default
							</button>
						)}
						<button
							type="button"
							onClick={() => validateMutation.mutate()}
							disabled={validateMutation.isPending}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Validate
						</button>
						<ValidationStatus
							status={validationStatus}
							saveError={saveMutation.isError ? saveMutation.error.message : undefined}
						/>
					</div>
				</div>

				<ReferencePanel variables={variables} partials={partialsQuery.data} />
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
		required: ['fs:read', 'session:ctrl'],
		optional: [],
	},
	triggers: [],
	strategies: {},
	backend: { needsGitHubToken: false },
	hint: '',
	trailingMessage: undefined,
	prompts: {
		taskPrompt:
			'Analyze and process the work item with ID: <%= it.cardId %>. The work item data has been pre-loaded.',
	},
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
	const [agentTypeError, setAgentTypeError] = useState<string | null>(null);
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
		const structuredTabs = ['definition', 'capabilities', 'triggers'];
		const isLeavingStructured = structuredTabs.includes(activeTab);
		const isEnteringStructured = structuredTabs.includes(tab);

		if (tab === 'json' && isLeavingStructured) {
			setJsonText(JSON.stringify(def, null, 2));
			setJsonError(null);
		} else if (isEnteringStructured && activeTab === 'json') {
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
		if (!isEdit && !agentType.trim()) {
			setAgentTypeError('Agent type is required.');
			return;
		}

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
	const setBackend = (k: keyof AgentDefinition['backend'], v: unknown) =>
		setDef((d) => ({ ...d, backend: { ...d.backend, [k]: v } }));
	const setTrailing = (k: string, v: boolean) =>
		setDef((d) => ({ ...d, trailingMessage: { ...(d.trailingMessage ?? {}), [k]: v } }));

	const clearJsonError = () => setJsonError(null);

	const updateAgentType = (value: string) => {
		setAgentType(value);
		if (agentTypeError) setAgentTypeError(null);
	};

	return {
		isEdit,
		agentType,
		setAgentType: updateAgentType,
		def,
		setDef,
		jsonText,
		setJsonText,
		jsonError,
		clearJsonError,
		agentTypeError,
		activeTab,
		activeMutation,
		handleTabChange,
		handleSave,
		setIdentity,
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
		agentTypeError,
		activeTab,
		activeMutation,
		handleTabChange,
		handleSave,
		setIdentity,
		setBackend,
		setTrailing,
	} = useDefinitionEditor(existing, onClose);

	// ─────────────────────────────────────────────────────────────────────────
	return (
		<TooltipProvider delayDuration={200}>
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
						{/* Save is only shown for Definition / Raw JSON tabs (not Prompts which has its own save) */}
						{activeTab !== 'prompts' && (
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
							className={agentTypeError ? 'border-destructive' : ''}
						/>
						{agentTypeError && <p className="text-sm text-destructive">{agentTypeError}</p>}
					</div>
				)}

				{activeMutation.isError && (
					<p className="text-sm text-destructive">{activeMutation.error.message}</p>
				)}

				{/* Tabs */}
				<Tabs value={activeTab} onValueChange={handleTabChange}>
					<TabsList>
						<TabsTrigger value="definition">Definition</TabsTrigger>
						<TabsTrigger value="capabilities">Capabilities</TabsTrigger>
						<TabsTrigger value="triggers">Triggers</TabsTrigger>
						{isEdit && <TabsTrigger value="prompts">Prompts</TabsTrigger>}
						<TabsTrigger value="json">Raw JSON</TabsTrigger>
					</TabsList>

					<TabsContent value="definition" className="space-y-6 pt-4">
						<IdentitySection def={def} setIdentity={setIdentity} />
						<StrategiesSection def={def} setDef={setDef} />
						<BackendSection def={def} setBackend={setBackend} />

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
					</TabsContent>

					<TabsContent value="capabilities" className="space-y-6 pt-4">
						<CapabilitiesSection def={def} setDef={setDef} />
					</TabsContent>

					<TabsContent value="triggers" className="space-y-6 pt-4">
						<TriggersSection def={def} setDef={setDef} schema={schema} />
					</TabsContent>

					{isEdit && (
						<TabsContent value="prompts" className="pt-4">
							<PromptsPanel agentType={existing?.agentType ?? ''} />
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
		</TooltipProvider>
	);
}
