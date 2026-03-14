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
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
	runLinksEnabled?: boolean | null;
}

export function ProjectGeneralForm({ project }: { project: Project }) {
	const queryClient = useQueryClient();
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());
	const [name, setName] = useState(project.name);
	const [repo, setRepo] = useState(project.repo ?? '');
	const [baseBranch, setBaseBranch] = useState(project.baseBranch ?? 'main');
	const [branchPrefix, setBranchPrefix] = useState(project.branchPrefix ?? 'feature/');
	const [model, setModel] = useState(project.model ?? '');
	const [maxIterations, setMaxIterations] = useState(
		project.maxIterations != null ? String(project.maxIterations) : '',
	);
	const [watchdogTimeoutMs, setWatchdogTimeoutMs] = useState(
		project.watchdogTimeoutMs != null ? String(project.watchdogTimeoutMs) : '',
	);
	const [progressModel, setProgressModel] = useState(project.progressModel ?? '');
	const [progressIntervalMinutes, setProgressIntervalMinutes] = useState(
		project.progressIntervalMinutes ?? '',
	);
	const [workItemBudgetUsd, setWorkItemBudgetUsd] = useState(project.workItemBudgetUsd ?? '');
	const [agentEngine, setAgentEngine] = useState(project.agentEngine ?? '');
	const [engineSettings, setEngineSettings] = useState<Record<string, Record<string, unknown>>>(
		project.engineSettings ?? {},
	);
	const [runLinksEnabled, setRunLinksEnabled] = useState(project.runLinksEnabled ?? false);

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
			maxIterations: maxIterations ? Number.parseInt(maxIterations, 10) : null,
			watchdogTimeoutMs: watchdogTimeoutMs ? Number.parseInt(watchdogTimeoutMs, 10) : null,
			progressModel: progressModel || null,
			progressIntervalMinutes: progressIntervalMinutes || null,
			workItemBudgetUsd: workItemBudgetUsd || null,
			agentEngine: agentEngine || null,
			engineSettings: Object.keys(engineSettings).length > 0 ? engineSettings : null,
			runLinksEnabled,
		});
	}

	const effectiveEngineId = agentEngine || '';
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
						placeholder="e.g. 5.00"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="maxIterations">Max Iterations</Label>
					<Input
						id="maxIterations"
						type="number"
						min="1"
						value={maxIterations}
						onChange={(e) => setMaxIterations(e.target.value)}
						placeholder="e.g. 20"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="watchdogTimeoutMs">Watchdog Timeout (ms)</Label>
					<Input
						id="watchdogTimeoutMs"
						type="number"
						min="1"
						value={watchdogTimeoutMs}
						onChange={(e) => setWatchdogTimeoutMs(e.target.value)}
						placeholder="e.g. 3600000"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="progressModel">Progress Model</Label>
					<Input
						id="progressModel"
						value={progressModel}
						onChange={(e) => setProgressModel(e.target.value)}
						placeholder="e.g. claude-haiku-3-5"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="progressIntervalMinutes">Progress Interval (minutes)</Label>
					<Input
						id="progressIntervalMinutes"
						type="number"
						min="1"
						value={progressIntervalMinutes}
						onChange={(e) => setProgressIntervalMinutes(e.target.value)}
						placeholder="e.g. 5"
					/>
				</div>
			</div>
			<div className="space-y-2">
				<Label>Agent Engine</Label>
				<Select
					value={agentEngine || '_none'}
					onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select engine" />
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
			<EngineSettingsFields
				engine={effectiveEngine}
				engines={enginesQuery.data}
				value={engineSettings}
				onChange={(next) => setEngineSettings(next ?? {})}
			/>
			<div className="flex items-center gap-3">
				<input
					type="checkbox"
					id="runLinksEnabled"
					checked={runLinksEnabled}
					onChange={(e) => setRunLinksEnabled(e.target.checked)}
					className="h-4 w-4 rounded border-border"
				/>
				<Label htmlFor="runLinksEnabled" className="cursor-pointer">
					Enable run links in comments (requires{' '}
					<code className="text-xs">CASCADE_DASHBOARD_URL</code> env var)
				</Label>
			</div>
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
