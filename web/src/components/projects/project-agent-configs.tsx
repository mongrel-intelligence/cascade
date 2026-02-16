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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { Textarea } from '@/components/ui/textarea.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface AgentConfig {
	id: number;
	agentType: string;
	model: string | null;
	maxIterations: number | null;
	agentBackend: string | null;
	prompt: string | null;
}

export function ProjectAgentConfigs({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const configsQuery = useQuery(trpc.agentConfigs.list.queryOptions({ projectId }));

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AgentConfig | null>(null);
	const [agentType, setAgentType] = useState('');
	const [model, setModel] = useState('');
	const [maxIterations, setMaxIterations] = useState('');
	const [agentBackend, setAgentBackend] = useState('');
	const [prompt, setPrompt] = useState('');

	const queryKey = trpc.agentConfigs.list.queryOptions({ projectId }).queryKey;

	function openCreate() {
		setEditing(null);
		setAgentType('');
		setModel('');
		setMaxIterations('');
		setAgentBackend('');
		setPrompt('');
		setDialogOpen(true);
	}

	function openEdit(config: AgentConfig) {
		setEditing(config);
		setAgentType(config.agentType);
		setModel(config.model ?? '');
		setMaxIterations(config.maxIterations?.toString() ?? '');
		setAgentBackend(config.agentBackend ?? '');
		setPrompt(config.prompt ?? '');
		setDialogOpen(true);
	}

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.create.mutate({
				projectId,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: prompt || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			setDialogOpen(false);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.agentConfigs.update.mutate({
				id: editing?.id as number,
				agentType,
				model: model || null,
				maxIterations: maxIterations ? Number(maxIterations) : null,
				agentBackend: agentBackend || null,
				prompt: prompt || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			setDialogOpen(false);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.agentConfigs.delete.mutate({ id }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	if (configsQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading agent configs...</div>;
	}

	const configs = (configsQuery.data ?? []) as AgentConfig[];
	const activeMutation = editing ? updateMutation : createMutation;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">Per-agent overrides scoped to this project.</p>
				<button
					type="button"
					onClick={openCreate}
					className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" /> Add Config
				</button>
			</div>

			<div className="overflow-hidden rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Agent Type</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Max Iterations</TableHead>
							<TableHead>Backend</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{configs.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-muted-foreground py-8">
									No project-scoped agent configs
								</TableCell>
							</TableRow>
						)}
						{configs.map((config) => (
							<TableRow key={config.id}>
								<TableCell className="font-medium">{config.agentType}</TableCell>
								<TableCell>{config.model ?? '-'}</TableCell>
								<TableCell>{config.maxIterations ?? '-'}</TableCell>
								<TableCell>{config.agentBackend ?? '-'}</TableCell>
								<TableCell>
									<div className="flex gap-1">
										<button
											type="button"
											onClick={() => openEdit(config)}
											className="p-1 text-muted-foreground hover:text-foreground"
										>
											<Pencil className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() => deleteMutation.mutate(config.id)}
											className="p-1 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
						<div className="space-y-2">
							<Label htmlFor="ac-agentType">Agent Type</Label>
							<Input
								id="ac-agentType"
								value={agentType}
								onChange={(e) => setAgentType(e.target.value)}
								placeholder="e.g. implementation, review"
								required
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="ac-model">Model</Label>
								<Input
									id="ac-model"
									value={model}
									onChange={(e) => setModel(e.target.value)}
									placeholder="Optional"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="ac-iterations">Max Iterations</Label>
								<Input
									id="ac-iterations"
									type="number"
									value={maxIterations}
									onChange={(e) => setMaxIterations(e.target.value)}
									placeholder="Optional"
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label>Backend</Label>
							<Select
								value={agentBackend || '_none'}
								onValueChange={(v) => setAgentBackend(v === '_none' ? '' : v)}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Optional" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="_none">None</SelectItem>
									<SelectItem value="llmist">llmist</SelectItem>
									<SelectItem value="claude-code">claude-code</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="ac-prompt">Prompt</Label>
							<Textarea
								id="ac-prompt"
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								placeholder="Optional system prompt override"
								rows={3}
							/>
						</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setDialogOpen(false)}
								className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={activeMutation.isPending}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{activeMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
							</button>
						</div>
						{activeMutation.isError && (
							<p className="text-sm text-destructive">{activeMutation.error.message}</p>
						)}
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
