import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PromptsPanel } from './agent-definition-prompts.js';
import {
	CapabilitiesSection,
	HooksSection,
	IdentitySection,
	StrategiesSection,
	TriggersSection,
} from './agent-definition-sections.js';
import {
	type AgentDefinition,
	type DefinitionRow,
	EMPTY_DEFINITION,
	TooltipProvider,
} from './agent-definition-shared.js';

export interface AgentDefinitionEditorProps {
	/** When provided, we are editing an existing definition. When undefined, we are creating a new one. */
	existing?: DefinitionRow;
	onClose: () => void;
}

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
						<HooksSection def={def} setDef={setDef} />

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
