/**
 * Form section sub-components for the agent definition editor.
 * Each section renders one tab of content in the editor.
 * Extracted from agent-definition-editor.tsx.
 *
 * Dependencies come exclusively from agent-definition-shared.tsx (not from the editor).
 */
import {
	type KnownTriggerEvent,
	TRIGGER_CATEGORY_LABELS,
} from '@/../../src/api/routers/_shared/triggerTypes.js';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Textarea } from '@/components/ui/textarea.js';
import {
	type AgentDefinition,
	CAPABILITY_GROUPS,
	type Capability,
	type SchemaData,
	Toggle,
	deepSet,
} from './agent-definition-shared.js';

// ─────────────────────────────────────────────────────────────────────────────
// IdentitySection
// ─────────────────────────────────────────────────────────────────────────────

export function IdentitySection({
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

// ─────────────────────────────────────────────────────────────────────────────
// CapabilitiesSection
// ─────────────────────────────────────────────────────────────────────────────

export function CapabilitiesSection({
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

// ─────────────────────────────────────────────────────────────────────────────
// StrategiesSection
// ─────────────────────────────────────────────────────────────────────────────

export function StrategiesSection({
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

// ─────────────────────────────────────────────────────────────────────────────
// HooksSection
// ─────────────────────────────────────────────────────────────────────────────

export function HooksSection({
	def,
	setDef,
}: {
	def: AgentDefinition;
	setDef: React.Dispatch<React.SetStateAction<AgentDefinition>>;
}) {
	const setHookValue = (path: string[], v: boolean) => {
		setDef((d) => ({ ...d, hooks: deepSet((d.hooks ?? {}) as Record<string, unknown>, path, v) }));
	};

	const trailing = def.hooks?.trailing;
	const finish = def.hooks?.finish;

	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hooks</h3>

			{/* Trailing Messages */}
			<div className="rounded-md border border-border p-3 space-y-3">
				<div className="text-sm font-medium">Trailing Messages</div>

				<div className="space-y-2">
					<div className="text-xs font-medium text-muted-foreground uppercase">SCM</div>
					<div className="grid grid-cols-2 gap-2">
						<Toggle
							checked={trailing?.scm?.gitStatus ?? false}
							onChange={(v) => setHookValue(['trailing', 'scm', 'gitStatus'], v)}
							label="Git Status"
							description="Appends git status showing uncommitted changes to each iteration message."
						/>
						<Toggle
							checked={trailing?.scm?.prStatus ?? false}
							onChange={(v) => setHookValue(['trailing', 'scm', 'prStatus'], v)}
							label="PR Status"
							description="Appends PR view showing current state and checks to each iteration message."
						/>
					</div>
				</div>

				<div className="space-y-2">
					<div className="text-xs font-medium text-muted-foreground uppercase">Built-in</div>
					<div className="grid grid-cols-2 gap-2">
						<Toggle
							checked={trailing?.builtin?.diagnostics ?? false}
							onChange={(v) => setHookValue(['trailing', 'builtin', 'diagnostics'], v)}
							label="Diagnostics"
							description="Appends lint/type-check errors and loop detection warnings to each iteration message."
						/>
						<Toggle
							checked={trailing?.builtin?.todoProgress ?? false}
							onChange={(v) => setHookValue(['trailing', 'builtin', 'todoProgress'], v)}
							label="Todo Progress"
							description="Appends the current todo checklist progress to each iteration message."
						/>
						<Toggle
							checked={trailing?.builtin?.reminder ?? false}
							onChange={(v) => setHookValue(['trailing', 'builtin', 'reminder'], v)}
							label="Reminder"
							description="Appends an efficiency reminder to batch gadget calls in each iteration message."
						/>
					</div>
				</div>
			</div>

			{/* Finish Requirements */}
			<div className="rounded-md border border-border p-3 space-y-2">
				<div className="text-sm font-medium">Finish Requirements</div>
				<div className="text-xs font-medium text-muted-foreground uppercase">SCM</div>
				<div className="grid grid-cols-2 gap-2">
					<Toggle
						checked={finish?.scm?.requiresPR ?? false}
						onChange={(v) => setHookValue(['finish', 'scm', 'requiresPR'], v)}
						label="Requires PR"
						description="Agent must create a PR before the session can finish."
					/>
					<Toggle
						checked={finish?.scm?.requiresReview ?? false}
						onChange={(v) => setHookValue(['finish', 'scm', 'requiresReview'], v)}
						label="Requires Review"
						description="Agent must submit a code review before the session can finish."
					/>
					<Toggle
						checked={finish?.scm?.requiresPushedChanges ?? false}
						onChange={(v) => setHookValue(['finish', 'scm', 'requiresPushedChanges'], v)}
						label="Requires Pushed Changes"
						description="Agent must commit and push changes before the session can finish."
					/>
					<Toggle
						checked={finish?.scm?.blockGitPush ?? false}
						onChange={(v) => setHookValue(['finish', 'scm', 'blockGitPush'], v)}
						label="Block Git Push"
						description="Prevents direct pushes, requiring cascade-tools for PRs. Disable for existing PR branches."
					/>
				</div>
			</div>
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// TriggersSection
// ─────────────────────────────────────────────────────────────────────────────

export function TriggersSection({
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

	const categories = ['pm', 'scm', 'email', 'internal'] as const;

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
