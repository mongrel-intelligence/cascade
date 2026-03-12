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
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	maxConcurrency: number | null;
}

interface AgentConfigFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config?: AgentConfig;
}

export function AgentConfigFormDialog({ open, onOpenChange, config }: AgentConfigFormDialogProps) {
	const queryClient = useQueryClient();
	const isEdit = !!config;
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());

	const [agentType, setAgentType] = useState(config?.agentType ?? '');
	const [model, setModel] = useState(config?.model ?? '');
	const [maxIterations, setMaxIterations] = useState(config?.maxIterations?.toString() ?? '');
	const [agentEngine, setAgentEngine] = useState(config?.agentEngine ?? '');
	const [maxConcurrency, setMaxConcurrency] = useState(config?.maxConcurrency?.toString() ?? '');

	const queryKey = trpc.agentConfigs.list.queryOptions().queryKey;

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentEngine: agentEngine || null,
				maxConcurrency: maxConcurrency ? Number(maxConcurrency) : null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			onOpenChange(false);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.update.mutate({
				id: config?.id as number,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentEngine: agentEngine || null,
				maxConcurrency: maxConcurrency ? Number(maxConcurrency) : null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			onOpenChange(false);
		},
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

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
					<div className="space-y-2">
						<Label htmlFor="gac-agentType">Agent Type</Label>
						<Input
							id="gac-agentType"
							value={agentType}
							onChange={(e) => setAgentType(e.target.value)}
							placeholder="e.g. implementation, review, splitting"
							required
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="gac-model">Model</Label>
							<ModelField id="gac-model" value={model} onChange={setModel} engine={agentEngine} />
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
					<div className="space-y-2">
						<Label htmlFor="gac-concurrency">Max Concurrency</Label>
						<Input
							id="gac-concurrency"
							type="number"
							min={1}
							value={maxConcurrency}
							onChange={(e) => setMaxConcurrency(e.target.value)}
							placeholder="Optional — limits concurrent runs per project"
						/>
					</div>
					<div className="space-y-2">
						<Label>Engine</Label>
						<Select
							value={agentEngine || '_none'}
							onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Optional" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none">None</SelectItem>
								{enginesQuery.data?.map((engine) => (
									<SelectItem key={engine.id} value={engine.id}>
										{engine.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>Prompt</Label>
						<p className="text-sm text-muted-foreground">
							Prompts are managed in{' '}
							<Link to="/settings/definitions" className="text-primary hover:underline">
								Agent Definitions
							</Link>
						</p>
					</div>
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
							disabled={activeMutation.isPending}
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
