import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
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
import { useState } from 'react';

interface Project {
	id: string;
	name: string;
	repo?: string | null;
	baseBranch: string | null;
	branchPrefix: string | null;
	model: string | null;
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
	subscriptionCostZero: boolean | null;
}

export function ProjectGeneralForm({ project }: { project: Project }) {
	const queryClient = useQueryClient();
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());
	const defaultsQuery = useQuery(trpc.defaults.get.queryOptions());
	const [name, setName] = useState(project.name);
	const [repo, setRepo] = useState(project.repo ?? '');
	const [baseBranch, setBaseBranch] = useState(project.baseBranch ?? 'main');
	const [branchPrefix, setBranchPrefix] = useState(project.branchPrefix ?? 'feature/');
	const [model, setModel] = useState(project.model ?? '');
	const [workItemBudgetUsd, setWorkItemBudgetUsd] = useState(project.workItemBudgetUsd ?? '');
	const [agentEngine, setAgentEngine] = useState(project.agentEngine ?? '');
	const [engineSettings, setEngineSettings] = useState<Record<string, Record<string, unknown>>>(
		project.engineSettings ?? {},
	);
	const [subscriptionCostZero, setSubscriptionCostZero] = useState(
		project.subscriptionCostZero ?? false,
	);

	const updateMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) =>
			trpcClient.projects.update.mutate({ id: project.id, ...data } as Parameters<
				typeof trpcClient.projects.update.mutate
			>[0]),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.getById.queryOptions({ id: project.id }).queryKey,
			});
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
		},
	});

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate({
			name,
			repo: repo || undefined,
			baseBranch,
			branchPrefix,
			model: model || null,
			workItemBudgetUsd: workItemBudgetUsd || null,
			agentEngine: agentEngine || null,
			engineSettings: Object.keys(engineSettings).length > 0 ? engineSettings : null,
			subscriptionCostZero,
		});
	}

	const effectiveEngineId = agentEngine || defaultsQuery.data?.agentEngine || '';
	const effectiveEngine = enginesQuery.data?.find((engine) => engine.id === effectiveEngineId);

	return (
		<form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
				</div>
				<div className="space-y-2">
					<Label htmlFor="repo">Repository (optional)</Label>
					<Input
						id="repo"
						value={repo}
						onChange={(e) => setRepo(e.target.value)}
						placeholder="owner/repo"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="baseBranch">Base Branch</Label>
					<Input
						id="baseBranch"
						value={baseBranch}
						onChange={(e) => setBaseBranch(e.target.value)}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="branchPrefix">Branch Prefix</Label>
					<Input
						id="branchPrefix"
						value={branchPrefix}
						onChange={(e) => setBranchPrefix(e.target.value)}
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="model">Model</Label>
					<ModelField id="model" value={model} onChange={setModel} engine={effectiveEngineId} />
				</div>
				<div className="space-y-2">
					<Label htmlFor="workItemBudgetUsd">Work Item Budget (USD)</Label>
					<Input
						id="workItemBudgetUsd"
						value={workItemBudgetUsd}
						onChange={(e) => setWorkItemBudgetUsd(e.target.value)}
						placeholder="Inherits from defaults"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label>Agent Engine</Label>
					<Select
						value={agentEngine || '_none'}
						onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Inherits from defaults" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="_none">Inherits from defaults</SelectItem>
							{enginesQuery.data?.map((engine) => (
								<SelectItem key={engine.id} value={engine.id}>
									{engine.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-2 pt-6">
					<input
						id="subscriptionCostZero"
						type="checkbox"
						checked={subscriptionCostZero}
						onChange={(e) => setSubscriptionCostZero(e.target.checked)}
						className="h-4 w-4 rounded border-input"
					/>
					<Label htmlFor="subscriptionCostZero">Subscription Cost Zero</Label>
				</div>
			</div>
			<EngineSettingsFields
				engine={effectiveEngine}
				engines={enginesQuery.data}
				value={engineSettings}
				onChange={(next) => setEngineSettings(next ?? {})}
			/>
			<div className="flex items-center gap-2">
				<button
					type="submit"
					disabled={updateMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
				</button>
				{updateMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{updateMutation.isError && (
					<span className="text-sm text-destructive">{updateMutation.error.message}</span>
				)}
			</div>
		</form>
	);
}
