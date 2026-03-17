import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { OpenRouterModelCombobox } from '@/components/settings/openrouter-model-combobox.js';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { HelpCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface Project {
	id: string;
	name: string;
	repo: string | null;
	model: string | null;
	maxIterations: number | null;
	watchdogTimeoutMs: number | null;
	progressModel: string | null;
	progressIntervalMinutes: string | null;
	workItemBudgetUsd: string | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
	runLinksEnabled?: boolean | null;
	maxInFlightItems?: number | null;
}

function numericFieldDefault(value: number | null | undefined): string {
	return value != null ? String(value) : '';
}

/** Convert watchdog ms → whole minutes for display */
function msToMinutes(ms: number | null | undefined): string {
	if (ms == null) return '';
	return String(Math.round(ms / 60000));
}

/** Convert minutes string → ms for storage */
function minutesToMs(minutes: string): number | null {
	if (!minutes) return null;
	const parsed = Number.parseInt(minutes, 10);
	return Number.isNaN(parsed) ? null : parsed * 60000;
}

/** Convert a DB interval value (may be "5.0") to integer string for display */
function intervalToInteger(value: string | null | undefined): string {
	if (!value) return '';
	const n = Math.round(Number(value));
	return Number.isNaN(n) ? '' : String(n);
}

export function ProjectGeneralForm({ project }: { project: Project }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const updateMutation = useProjectUpdate(project.id);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.projects.delete.mutate({ id: project.id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
			queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryOptions().queryKey });
			navigate({ to: '/' });
		},
		onError: (err) => {
			toast.error('Failed to delete project', { description: err.message });
		},
	});

	const credentialsQuery = useQuery(
		trpc.projects.credentials.list.queryOptions({ projectId: project.id }),
	);
	const defaultsQuery = useQuery({
		...trpc.projects.defaults.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const defaults = defaultsQuery.data;

	const [name, setName] = useState(project.name);
	const [watchdogMinutes, setWatchdogMinutes] = useState(msToMinutes(project.watchdogTimeoutMs));
	const [progressModel, setProgressModel] = useState(project.progressModel ?? '');
	const [progressIntervalMinutes, setProgressIntervalMinutes] = useState(
		intervalToInteger(project.progressIntervalMinutes),
	);
	const [workItemBudgetUsd, setWorkItemBudgetUsd] = useState(project.workItemBudgetUsd ?? '');
	const [maxInFlightItems, setMaxInFlightItems] = useState(
		numericFieldDefault(project.maxInFlightItems),
	);
	const [runLinksEnabled, setRunLinksEnabled] = useState(project.runLinksEnabled ?? false);

	// Track dirty state to enable/disable Save button
	const isDirty = useMemo(() => {
		return (
			name !== project.name ||
			watchdogMinutes !== msToMinutes(project.watchdogTimeoutMs) ||
			progressModel !== (project.progressModel ?? '') ||
			progressIntervalMinutes !== intervalToInteger(project.progressIntervalMinutes) ||
			workItemBudgetUsd !== (project.workItemBudgetUsd ?? '') ||
			maxInFlightItems !== numericFieldDefault(project.maxInFlightItems) ||
			runLinksEnabled !== (project.runLinksEnabled ?? false)
		);
	}, [
		name,
		watchdogMinutes,
		progressModel,
		progressIntervalMinutes,
		workItemBudgetUsd,
		maxInFlightItems,
		runLinksEnabled,
		project,
	]);

	function handleReset() {
		setName(project.name);
		setWatchdogMinutes(msToMinutes(project.watchdogTimeoutMs));
		setProgressModel(project.progressModel ?? '');
		setProgressIntervalMinutes(intervalToInteger(project.progressIntervalMinutes));
		setWorkItemBudgetUsd(project.workItemBudgetUsd ?? '');
		setMaxInFlightItems(numericFieldDefault(project.maxInFlightItems));
		setRunLinksEnabled(project.runLinksEnabled ?? false);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate(
			{
				name,
				watchdogTimeoutMs: minutesToMs(watchdogMinutes),
				progressModel: progressModel || null,
				progressIntervalMinutes: progressIntervalMinutes || null,
				workItemBudgetUsd: workItemBudgetUsd || null,
				maxInFlightItems: maxInFlightItems ? Number.parseInt(maxInFlightItems, 10) : null,
				runLinksEnabled,
			},
			{
				onSuccess: () => {
					toast.success('Project settings saved');
				},
				onError: (err) => {
					toast.error('Failed to save project settings', { description: err.message });
				},
			},
		);
	}

	const credentials = credentialsQuery.data ?? [];
	const openrouterCred = credentials.find((c) => c.envVarKey === 'OPENROUTER_API_KEY');

	// Pre-compute placeholder/description values so JSX stays declarative
	const budgetPlaceholder = defaults
		? `${defaults.workItemBudgetUsd.toFixed(2)} (default)`
		: 'e.g. 5.00';
	const watchdogDefaultMinutes = defaults ? Math.round(defaults.watchdogTimeoutMs / 60000) : null;
	const watchdogPlaceholder =
		watchdogDefaultMinutes != null ? `${watchdogDefaultMinutes} (default)` : 'e.g. 30';
	const watchdogDescription =
		watchdogDefaultMinutes != null ? `Default: ${watchdogDefaultMinutes} min` : '…';
	const progressModelPlaceholder = defaults ? defaults.progressModel : 'e.g. gemini-flash';
	const progressIntervalPlaceholder = defaults
		? `${defaults.progressIntervalMinutes} (default)`
		: 'e.g. 5';

	return (
		<TooltipProvider>
			<div className="max-w-2xl space-y-6">
				<form onSubmit={handleSubmit} className="space-y-6">
					{/* Project Identity */}
					<Card>
						<CardHeader>
							<CardTitle>Project Identity</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
								<p className="text-xs text-muted-foreground">
									Display name for this project shown in the dashboard.
								</p>
							</div>
						</CardContent>
					</Card>

					{/* Budget & Limits */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-1.5">
								<CardTitle>Budget &amp; Limits</CardTitle>
								<Tooltip>
									<TooltipTrigger asChild>
										<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
									</TooltipTrigger>
									<TooltipContent>
										Control spending and concurrency limits for agent runs.
									</TooltipContent>
								</Tooltip>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="workItemBudgetUsd">Work Item Budget (USD)</Label>
									<Input
										id="workItemBudgetUsd"
										className="w-32"
										value={workItemBudgetUsd}
										onChange={(e) => setWorkItemBudgetUsd(e.target.value)}
										placeholder={budgetPlaceholder}
									/>
									<p className="text-xs text-muted-foreground">
										Max spend per work item. Default: $
										{defaults ? defaults.workItemBudgetUsd.toFixed(2) : '…'}.
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="maxInFlightItems">Max In-Flight Items</Label>
									<Input
										id="maxInFlightItems"
										type="number"
										min="1"
										step="1"
										className="w-32"
										value={maxInFlightItems}
										onChange={(e) => setMaxInFlightItems(e.target.value)}
										placeholder="1 (default)"
									/>
									<p className="text-xs text-muted-foreground">
										Max items in TODO + In Progress + In Review. Default: 1.
									</p>
								</div>
							</div>
							<div className="space-y-2">
								<div className="flex items-center gap-1.5">
									<Label htmlFor="watchdogMinutes">Max Session Time (min)</Label>
									<Tooltip>
										<TooltipTrigger asChild>
											<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
										</TooltipTrigger>
										<TooltipContent>
											Maximum duration before a stalled agent run is forcibly terminated.
										</TooltipContent>
									</Tooltip>
								</div>
								<Input
									id="watchdogMinutes"
									type="number"
									min="1"
									step="1"
									className="w-32"
									value={watchdogMinutes}
									onChange={(e) => setWatchdogMinutes(e.target.value)}
									placeholder={watchdogPlaceholder}
								/>
								<p className="text-xs text-muted-foreground">{watchdogDescription}</p>
							</div>
						</CardContent>
					</Card>

					{/* Progress Monitoring */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-1.5">
								<CardTitle>Progress Monitoring</CardTitle>
								<Tooltip>
									<TooltipTrigger asChild>
										<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
									</TooltipTrigger>
									<TooltipContent>
										Configure how agent progress is reported during long-running tasks.
									</TooltipContent>
								</Tooltip>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="progressModel">Progress Model</Label>
									<OpenRouterModelCombobox
										id="progressModel"
										projectId={project.id}
										value={progressModel}
										onChange={setProgressModel}
										placeholder={progressModelPlaceholder}
									/>
									<p className="text-xs text-muted-foreground">LLM model for progress summaries.</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="progressIntervalMinutes">Progress Interval (min)</Label>
									<Input
										id="progressIntervalMinutes"
										type="number"
										min="1"
										step="1"
										className="w-32"
										value={progressIntervalMinutes}
										onChange={(e) => setProgressIntervalMinutes(e.target.value)}
										placeholder={progressIntervalPlaceholder}
									/>
									<p className="text-xs text-muted-foreground">
										How often the agent posts a progress update.
									</p>
								</div>
							</div>
							<div className="flex items-center gap-3">
								<input
									type="checkbox"
									id="runLinksEnabled"
									checked={runLinksEnabled}
									onChange={(e) => setRunLinksEnabled(e.target.checked)}
									className="h-4 w-4 rounded border-border"
								/>
								<div>
									<Label htmlFor="runLinksEnabled" className="cursor-pointer">
										Enable run links in comments
									</Label>
									<p className="text-xs text-muted-foreground mt-0.5">
										Adds a dashboard link to agent comments.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Save / Reset */}
					<div className="flex items-center gap-2">
						<button
							type="submit"
							disabled={updateMutation.isPending || !isDirty}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
						</button>
						<button
							type="button"
							onClick={handleReset}
							disabled={!isDirty}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
						>
							Reset
						</button>
					</div>
				</form>

				{/* Danger Zone */}
				<Card className="border-destructive/50">
					<CardHeader>
						<CardTitle className="text-destructive">Danger Zone</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium">Delete this project</p>
								<p className="text-xs text-muted-foreground">
									Permanently delete this project and all its integrations, credentials, and agent
									configs. This action cannot be undone.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setDeleteDialogOpen(true)}
								className="ml-4 inline-flex h-9 shrink-0 items-center rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
							>
								Delete Project
							</button>
						</div>
					</CardContent>
				</Card>

				<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete Project</AlertDialogTitle>
							<AlertDialogDescription>
								This will permanently delete <strong>{project.name}</strong> and all its
								integrations, credential overrides, and agent configs. This action cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => deleteMutation.mutate()}
								className="bg-destructive text-white hover:bg-destructive/90"
							>
								{deleteMutation.isPending ? 'Deleting...' : 'Delete'}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* API Keys */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-1.5">
							<CardTitle>API Keys</CardTitle>
							<Tooltip>
								<TooltipTrigger asChild>
									<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent>
									Project-scoped API keys for LLM providers. Values are stored encrypted and never
									returned to the browser. Engine-specific keys are on the Engine tab.
								</TooltipContent>
							</Tooltip>
						</div>
					</CardHeader>
					<CardContent>
						<ProjectSecretField
							projectId={project.id}
							envVarKey="OPENROUTER_API_KEY"
							label="OpenRouter API Key"
							description="API key for OpenRouter LLM routing (progress model). Also used as the engine API key when the OpenCode engine is selected — configure it here or on the Engine tab."
							placeholder="sk-or-..."
							credential={openrouterCred}
						/>
					</CardContent>
				</Card>
			</div>
		</TooltipProvider>
	);
}
