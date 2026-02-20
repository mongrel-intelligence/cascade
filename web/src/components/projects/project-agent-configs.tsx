import { AgentTriggerConfig } from '@/components/projects/agent-trigger-config.js';
import { ModelField } from '@/components/settings/model-field.js';
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
import { KNOWN_AGENT_TYPES } from '@/lib/trigger-agent-mapping.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
}

// ---- Agent type select + custom input ----

function AgentTypeSelect({
	value,
	customValue,
	onValueChange,
	onCustomChange,
}: {
	value: string;
	customValue: string;
	onValueChange: (v: string) => void;
	onCustomChange: (v: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor="ac-agentType">Agent Type</Label>
			<Select value={value} onValueChange={onValueChange}>
				<SelectTrigger id="ac-agentType" className="w-full">
					<SelectValue placeholder="Select agent type..." />
				</SelectTrigger>
				<SelectContent>
					{KNOWN_AGENT_TYPES.map((type) => (
						<SelectItem key={type} value={type}>
							{type}
						</SelectItem>
					))}
					<SelectItem value="_custom">Other (custom type)</SelectItem>
				</SelectContent>
			</Select>
			{value === '_custom' && (
				<Input
					value={customValue}
					onChange={(e) => onCustomChange(e.target.value)}
					placeholder="Custom agent type name"
					required
				/>
			)}
		</div>
	);
}

// ---- Prompt field ----

function PromptField({ hasPrompt }: { hasPrompt?: boolean }) {
	return (
		<div className="space-y-2">
			<Label>Prompt</Label>
			{hasPrompt ? (
				<p className="text-sm text-muted-foreground">
					Custom prompt set.{' '}
					<Link to="/settings/prompts" className="text-primary hover:underline">
						Edit in Prompt Editor
					</Link>
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Using default.{' '}
					<Link to="/settings/prompts" className="text-primary hover:underline">
						Customize in Prompt Editor
					</Link>
				</p>
			)}
		</div>
	);
}

// ---- Shared form sub-components ----

function BackendSelectField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	return (
		<div className="space-y-2">
			<Label>Backend</Label>
			<Select value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder="Optional" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="_none">None (use default)</SelectItem>
					<SelectItem value="llmist">llmist</SelectItem>
					<SelectItem value="claude-code">claude-code</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function AgentModelIterationsFields({
	model,
	onModelChange,
	agentBackend,
	maxIterations,
	onMaxIterationsChange,
}: {
	model: string;
	onModelChange: (v: string) => void;
	agentBackend: string;
	maxIterations: string;
	onMaxIterationsChange: (v: string) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-4">
			<div className="space-y-2">
				<Label htmlFor="ac-model">Model</Label>
				<ModelField id="ac-model" value={model} onChange={onModelChange} backend={agentBackend} />
			</div>
			<div className="space-y-2">
				<Label htmlFor="ac-iterations">Max Iterations</Label>
				<Input
					id="ac-iterations"
					type="number"
					value={maxIterations}
					onChange={(e) => onMaxIterationsChange(e.target.value)}
					placeholder="Optional"
				/>
			</div>
		</div>
	);
}

function DialogActions({
	isPending,
	isDisabled,
	isEdit,
	onCancel,
}: {
	isPending: boolean;
	isDisabled: boolean;
	isEdit: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="flex justify-end gap-2">
			<button
				type="button"
				onClick={onCancel}
				className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={isPending || isDisabled}
				className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
			</button>
		</div>
	);
}

// ---- Project agent config dialog ----

interface AgentConfigDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing: AgentConfig | null;
	projectId: string;
}

function useAgentConfigMutations(
	projectId: string,
	editing: AgentConfig | null,
	resolvedAgentType: string,
	model: string,
	maxIterations: string,
	agentBackend: string,
	onSuccess: () => void,
) {
	const queryClient = useQueryClient();
	const queryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;
	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType: resolvedAgentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: null,
			}),
		onSuccess: () => {
			invalidate();
			onSuccess();
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.update.mutate({
				id: editing?.id as number,
				agentType: resolvedAgentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: editing?.prompt ?? null,
			}),
		onSuccess: () => {
			invalidate();
			onSuccess();
		},
	});

	return editing ? updateMutation : createMutation;
}

function resolveInitialAgentType(editing: AgentConfig | null) {
	if (!editing) return { agentType: '', customAgentType: '' };
	const isKnown = (KNOWN_AGENT_TYPES as readonly string[]).includes(editing.agentType);
	return {
		agentType: isKnown ? editing.agentType : '_custom',
		customAgentType: isKnown ? '' : editing.agentType,
	};
}

function AgentConfigDialog({ open, onOpenChange, editing, projectId }: AgentConfigDialogProps) {
	const initial = resolveInitialAgentType(editing);

	const [agentType, setAgentType] = useState(initial.agentType);
	const [customAgentType, setCustomAgentType] = useState(initial.customAgentType);
	const [model, setModel] = useState(editing?.model ?? '');
	const [maxIterations, setMaxIterations] = useState(editing?.maxIterations?.toString() ?? '');
	const [agentBackend, setAgentBackend] = useState(editing?.agentBackend ?? '');

	const resolvedAgentType = agentType === '_custom' ? customAgentType : agentType;

	const activeMutation = useAgentConfigMutations(
		projectId,
		editing,
		resolvedAgentType,
		model,
		maxIterations,
		agentBackend,
		() => onOpenChange(false),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{editing ? 'Edit Agent Config' : 'New Agent Config'}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						activeMutation.mutate();
					}}
					className="space-y-4"
				>
					<AgentTypeSelect
						value={agentType}
						customValue={customAgentType}
						onValueChange={setAgentType}
						onCustomChange={setCustomAgentType}
					/>
					<AgentModelIterationsFields
						model={model}
						onModelChange={setModel}
						agentBackend={agentBackend}
						maxIterations={maxIterations}
						onMaxIterationsChange={setMaxIterations}
					/>
					<BackendSelectField value={agentBackend} onChange={setAgentBackend} />
					{editing && <PromptField hasPrompt={!!editing.prompt} />}
					<DialogActions
						isPending={activeMutation.isPending}
						isDisabled={!resolvedAgentType}
						isEdit={!!editing}
						onCancel={() => onOpenChange(false)}
					/>
					{activeMutation.isError && (
						<p className="text-sm text-destructive">{activeMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ---- Accordion row ----

function AgentConfigRow({
	config,
	projectId,
	trelloConfig,
	jiraConfig,
	onEdit,
	onDelete,
}: {
	config: AgentConfig;
	projectId: string;
	trelloConfig?: Record<string, unknown>;
	jiraConfig?: Record<string, unknown>;
	onEdit: (config: AgentConfig) => void;
	onDelete: (id: number) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<div className="flex items-center bg-muted/30 hover:bg-muted/50 transition-colors">
				<button
					type="button"
					className="flex flex-1 items-center gap-3 px-4 py-3 text-left"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
				>
					<span className="text-muted-foreground">
						{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
					</span>
					<span className="flex-1 font-medium text-sm">{config.agentType}</span>
					<span className="flex items-center gap-4 text-sm text-muted-foreground">
						{config.model && <span>{config.model}</span>}
						{config.maxIterations && <span>{config.maxIterations} iters</span>}
						{config.agentBackend && <span>{config.agentBackend}</span>}
					</span>
				</button>
				<div className="flex gap-1 px-2">
					<button
						type="button"
						onClick={() => onEdit(config)}
						className="p-1 text-muted-foreground hover:text-foreground"
						title="Edit agent config"
					>
						<Pencil className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => onDelete(config.id)}
						className="p-1 text-muted-foreground hover:text-destructive"
						title="Delete agent config"
					>
						<Trash2 className="h-4 w-4" />
					</button>
				</div>
			</div>

			{expanded && (
				<div className="px-4 py-4 space-y-3">
					<div className="grid grid-cols-3 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">Model: </span>
							<span>{config.model ?? 'default'}</span>
						</div>
						<div>
							<span className="text-muted-foreground">Max Iterations: </span>
							<span>{config.maxIterations ?? 'default'}</span>
						</div>
						<div>
							<span className="text-muted-foreground">Backend: </span>
							<span>{config.agentBackend ?? 'default'}</span>
						</div>
					</div>
					{config.prompt && (
						<div className="text-sm">
							<span className="text-muted-foreground">Prompt: </span>
							<Link to="/settings/prompts" className="text-primary hover:underline">
								custom
							</Link>
						</div>
					)}

					<AgentTriggerConfig
						projectId={projectId}
						agentType={config.agentType}
						trelloConfig={trelloConfig}
						jiraConfig={jiraConfig}
					/>
				</div>
			)}
		</div>
	);
}

// ---- Main component ----

export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AgentConfig | null>(null);

	const queryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;

	const trelloConfig = integrationsQuery.data?.find((i) => i.type === 'trello')?.config as
		| Record<string, unknown>
		| undefined;
	const jiraConfig = integrationsQuery.data?.find((i) => i.type === 'jira')?.config as
		| Record<string, unknown>
		| undefined;

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	function openCreate() {
		setEditing(null);
		setDialogOpen(true);
	}

	function openEdit(config: AgentConfig) {
		setEditing(config);
		setDialogOpen(true);
	}

	if (configsQuery.isLoading || integrationsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading agent configs...</div>;
	}

	const configs = (configsQuery.data ?? []) as AgentConfig[];

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					Per-agent overrides scoped to this project. Expand each agent to configure its trigger
					settings.
				</p>
				<button
					type="button"
					onClick={openCreate}
					className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" /> Add Config
				</button>
			</div>

			{configs.length === 0 ? (
				<div className="rounded-lg border border-border py-8 text-center text-muted-foreground text-sm">
					No project-scoped agent configs
				</div>
			) : (
				<div className="space-y-2">
					{configs.map((config) => (
						<AgentConfigRow
							key={config.id}
							config={config}
							projectId={projectId}
							trelloConfig={trelloConfig}
							jiraConfig={jiraConfig}
							onEdit={openEdit}
							onDelete={(id) => deleteMutation.mutate(id)}
						/>
					))}
				</div>
			)}

			<AgentConfigDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editing={editing}
				projectId={projectId}
			/>
		</div>
	);
}
