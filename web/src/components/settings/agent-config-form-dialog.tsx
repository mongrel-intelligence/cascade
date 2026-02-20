import {
	AgentTypeSelect,
	BackendSelect,
	PromptInfo,
	resolveInitialAgentType,
} from '@/components/settings/agent-config-shared.js';
import { ModelField } from '@/components/settings/model-field.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
}

interface AgentConfigFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config?: AgentConfig;
}

function useGlobalConfigMutation(
	config: AgentConfig | undefined,
	resolvedAgentType: string,
	model: string,
	maxIterations: string,
	agentBackend: string,
	onSuccess: () => void,
) {
	const queryClient = useQueryClient();
	const queryKey = trpc.agentConfigs.list.queryOptions().queryKey;
	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
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
				id: config?.id as number,
				agentType: resolvedAgentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: config?.prompt ?? null,
			}),
		onSuccess: () => {
			invalidate();
			onSuccess();
		},
	});

	return config ? updateMutation : createMutation;
}

export function AgentConfigFormDialog({ open, onOpenChange, config }: AgentConfigFormDialogProps) {
	const isEdit = !!config;
	const initial = resolveInitialAgentType(config?.agentType);

	const [agentType, setAgentType] = useState(initial.agentType);
	const [customAgentType, setCustomAgentType] = useState(initial.customAgentType);
	const [model, setModel] = useState(config?.model ?? '');
	const [maxIterations, setMaxIterations] = useState(config?.maxIterations?.toString() ?? '');
	const [agentBackend, setAgentBackend] = useState(config?.agentBackend ?? '');

	const resolvedAgentType = agentType === '_custom' ? customAgentType : agentType;
	const activeMutation = useGlobalConfigMutation(
		config,
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
					<DialogTitle>{isEdit ? 'Edit Agent Config' : 'New Agent Config'}</DialogTitle>
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
						id="gac-agentType"
					/>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="gac-model">Model</Label>
							<ModelField id="gac-model" value={model} onChange={setModel} backend={agentBackend} />
						</div>
						<div className="space-y-2">
							<Label htmlFor="gac-iterations">Max Iterations</Label>
							<Input
								id="gac-iterations"
								type="number"
								value={maxIterations}
								onChange={(e) => setMaxIterations(e.target.value)}
								placeholder="Optional"
							/>
						</div>
					</div>
					<BackendSelect value={agentBackend} onChange={setAgentBackend} />
					<PromptInfo hasPrompt={!!config?.prompt} />
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={activeMutation.isPending || !resolvedAgentType}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{activeMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
						</button>
					</div>
					{activeMutation.isError && (
						<p className="text-sm text-destructive">{activeMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
